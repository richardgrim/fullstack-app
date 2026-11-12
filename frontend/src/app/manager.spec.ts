import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { Manager } from "./manager";
const appointment = {
  id: 7,
  serviceName: "Consulta",
  clientName: "Alicia Demo",
  startsAt: "2026-11-10T13:00:00Z",
  endsAt: "2026-11-10T13:30:00Z",
  status: "confirmed",
  canComplete: true,
};
describe("Agenda del responsable", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [Manager],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup() {
    const fixture = TestBed.createComponent(Manager),
      http = TestBed.inject(HttpTestingController),
      component = fixture.componentInstance;
    http
      .expectOne((r) => r.url === "/api/management/agenda")
      .flush({ bookings: [appointment] });
    fixture.detectChanges();
    return { fixture, http, component };
  }
  it("muestra cliente, horas de Bolivia y acciones según permiso del servidor", () => {
    const { fixture, component } = setup();
    expect(fixture.nativeElement.textContent).toContain("09:00");
    expect(fixture.nativeElement.textContent).toContain("Alicia Demo");
    component.appointments.set([{ ...appointment, canComplete: false }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain("Marcar atendida");
  });
  it("filtros incluyen fecha y estado e ignoran respuesta anterior", () => {
    const { http, component } = setup();
    component.filter("2026-11-12", "confirmed");
    const old = http.expectOne((r) => r.url === "/api/management/agenda");
    component.filter("2026-11-13", "missed");
    const latest = http.expectOne((r) => r.url === "/api/management/agenda");
    expect(latest.request.params.get("date")).toBe("2026-11-13");
    expect(latest.request.params.get("status")).toBe("missed");
    latest.flush({ bookings: [] });
    old.flush({ bookings: [appointment] });
    expect(component.appointments()).toEqual([]);
  });
  it("requiere confirmación y evita doble envío al registrar resultado", () => {
    const { http, component } = setup();
    component.choose(appointment, "attended");
    http.expectNone((r) => r.method === "POST");
    component.confirm();
    component.confirm();
    const req = http.expectOne("/api/management/bookings/7/outcome");
    expect(req.request.body).toEqual({ status: "attended" });
    expect(req.request.headers.get("X-Agenda-Request")).toBe("1");
    req.flush({ booking: { id: 7, status: "attended" } });
    http
      .expectOne((r) => r.url === "/api/management/agenda")
      .flush({
        bookings: [{ ...appointment, status: "attended", canComplete: false }],
      });
    expect(component.notice()).toContain("Atendida");
    expect(component.pending()).toBe(null);
  });
  it("conflicto no muestra éxito y permite actualizar", () => {
    const { http, component } = setup();
    component.choose(appointment, "missed");
    component.confirm();
    http
      .expectOne("/api/management/bookings/7/outcome")
      .flush(
        { message: "La cita ya cambió." },
        { status: 409, statusText: "Conflict" },
      );
    expect(component.error()).toBe("La cita ya cambió.");
    expect(component.notice()).toBe("");
    expect(component.saving()).toBe(false);
  });
  it("error de permisos no se confunde con agenda vacía", () => {
    const { http, component, fixture } = setup();
    component.load();
    http
      .expectOne((r) => r.url === "/api/management/agenda")
      .flush(
        { message: "Solo para el responsable." },
        { status: 403, statusText: "Forbidden" },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Solo para el responsable",
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      "No hay citas para",
    );
  });
});
