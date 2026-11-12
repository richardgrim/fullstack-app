import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { App } from "./app";
const service = {
  id: 1,
  name: "Orientación",
  description: "Servicio ficticio",
  durationMinutes: 30,
};
describe("Catálogo y disponibilidad", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup() {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/services").flush({ services: [service] });
    http
      .expectOne("/api/auth/me")
      .flush({}, { status: 401, statusText: "Unauthorized" });
    fixture.detectChanges();
    return { fixture, http, app: fixture.componentInstance };
  }
  it("consulta horarios del servicio y muestra horas de Bolivia", () => {
    const { fixture, http, app } = setup();
    app.choose(service);
    app.search();
    const req = http.expectOne((r) => r.url === "/api/services/1/availability");
    expect(req.request.params.get("date")).toBe(app.today);
    req.flush({
      slots: [
        {
          startsAt: app.today + "T13:00:00Z",
          endsAt: app.today + "T13:30:00Z",
        },
      ],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("09:00");
    expect(fixture.nativeElement.textContent).toContain(
      "Seleccionar un horario no crea una cita.",
    );
  });
  it("ignora respuestas obsoletas cuando cambia el servicio", () => {
    const { http, app } = setup();
    app.choose(service);
    app.search();
    const req = http.expectOne((r) => r.url.endsWith("/availability"));
    app.choose({ ...service, id: 2 });
    req.flush({
      slots: [
        { startsAt: "2026-11-11T13:00:00Z", endsAt: "2026-11-11T13:30:00Z" },
      ],
    });
    expect(app.slots()).toEqual([]);
    expect(app.checked()).toBe(false);
  });
  it("distingue día sin cupos de error de conexión", () => {
    const { fixture, http, app } = setup();
    app.choose(service);
    app.search();
    http.expectOne((r) => r.url.endsWith("/availability")).flush({ slots: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "No hay horarios para este día",
    );
    app.search();
    http
      .expectOne((r) => r.url.endsWith("/availability"))
      .error(new ProgressEvent("error"));
    expect(app.checked()).toBe(false);
    expect(app.error()).toContain("No pudimos conectar");
    expect(app.searching()).toBe(false);
  });
  it("rechaza fechas pasadas sin enviar una consulta", () => {
    const { app } = setup();
    app.choose(service);
    app.changeDate("2000-01-01");
    app.search();
    expect(app.error()).toContain("próximos 90 días");
  });
});
