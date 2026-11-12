import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { Settings } from "./settings";
const service = {
  id: 1,
  name: "Consulta",
  description: "Servicio ficticio",
  durationMinutes: 30,
  active: true,
};
const block = {
  id: 4,
  startsAt: "2026-11-12T13:00:00Z",
  endsAt: "2026-11-12T13:30:00Z",
};
const data = {
  services: [service],
  hours: [{ weekday: 1, opens: "09:00", closes: "12:00" }],
  blocks: [block],
};
describe("Configuración del responsable", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup() {
    const fixture = TestBed.createComponent(Settings),
      http = TestBed.inject(HttpTestingController),
      component = fixture.componentInstance;
    http.expectOne("/api/management/settings").flush(data);
    fixture.detectChanges();
    return { fixture, http, component };
  }
  it("carga servicios, franjas y bloqueos en hora boliviana", () => {
    const { fixture, component } = setup();
    expect(fixture.nativeElement.textContent).toContain("09:00–09:30");
    expect(component.periods).toEqual([{ opens: "09:00", closes: "12:00" }]);
  });
  it("editar prepara cambios sin alterar catálogo ni enviar hasta confirmar", () => {
    const { http, component } = setup();
    component.edit(service);
    component.serviceName = "Nueva consulta";
    component.active = false;
    component.stageService();
    http.expectNone((r) => r.method === "POST");
    expect(component.config()?.services[0].name).toBe("Consulta");
    component.confirm();
    component.confirm();
    const req = http.expectOne("/api/management/settings/services/1");
    expect(req.request.body.active).toBe(false);
    expect(req.request.headers.get("X-Agenda-Request")).toBe("1");
    req.flush({ service: { id: 1 } });
    http
      .expectOne("/api/management/settings")
      .flush({
        ...data,
        services: [{ ...service, name: "Nueva consulta", active: false }],
      });
    expect(component.notice()).toContain("Cambio guardado");
  });
  it("crear servicio usa ruta de alta", () => {
    const { http, component } = setup();
    component.edit(null);
    component.serviceName = "Seguimiento";
    component.description = "Consulta posterior";
    component.duration = 45;
    component.stageService();
    component.confirm();
    const req = http.expectOne("/api/management/settings/services");
    expect(req.request.body.durationMinutes).toBe(45);
    req.flush({ service: { id: 2 } });
    http.expectOne("/api/management/settings").flush(data);
  });
  it("cerrar día pide confirmar y un conflicto conserva la configuración", () => {
    const { http, component } = setup();
    component.periods = [];
    component.stageHours();
    expect(component.pending()?.summary).toContain("cerrado");
    component.confirm();
    const req = http.expectOne("/api/management/settings/hours/1");
    expect(req.request.body).toEqual({ periods: [] });
    req.flush(
      { message: "Existen citas confirmadas." },
      { status: 409, statusText: "Conflict" },
    );
    expect(component.error()).toContain("citas confirmadas");
    expect(component.config()?.hours).toEqual(data.hours);
    expect(component.notice()).toBe("");
  });
  it("bloqueo envía fecha y horas locales y se refresca al guardar", () => {
    const { http, component } = setup();
    component.blockDate = "2026-11-12";
    component.blockOpens = "14:00";
    component.blockCloses = "15:00";
    component.stageBlock();
    component.confirm();
    const req = http.expectOne("/api/management/settings/blocks");
    expect(req.request.body).toEqual({
      date: "2026-11-12",
      opens: "14:00",
      closes: "15:00",
    });
    req.flush({ block: { id: 5 } });
    http.expectOne("/api/management/settings").flush(data);
    expect(component.saving()).toBe(false);
  });
  it("quitar bloqueo requiere confirmación explícita", () => {
    const { http, component } = setup();
    component.stageRemove(block);
    http.expectNone((r) => r.method === "POST");
    expect(component.pending()?.summary).toContain("Quitar el bloqueo #4");
    component.confirm();
    http
      .expectOne("/api/management/settings/blocks/4/remove")
      .flush({ removed: true });
    http.expectOne("/api/management/settings").flush({ ...data, blocks: [] });
    expect(component.config()?.blocks).toEqual([]);
  });
  it("error de permisos no presenta un formulario editable vacío", () => {
    const fixture = TestBed.createComponent(Settings),
      http = TestBed.inject(HttpTestingController);
    http
      .expectOne("/api/management/settings")
      .flush(
        { message: "Solo el responsable." },
        { status: 403, statusText: "Forbidden" },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Solo el responsable");
    expect(fixture.nativeElement.querySelector("fieldset")).toBe(null);
  });
});
