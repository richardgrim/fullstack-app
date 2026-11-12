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
const user = {
  id: 1,
  name: "Alicia Demo",
  email: "alicia@example.test",
  role: "client",
};
describe("Cuentas y reservas", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup(signedIn = true) {
    const fixture = TestBed.createComponent(App),
      http = TestBed.inject(HttpTestingController),
      app = fixture.componentInstance;
    http.expectOne("/api/services").flush({ services: [service] });
    if (signedIn) {
      http.expectOne("/api/auth/me").flush({ user });
      http.expectOne("/api/bookings").flush({ bookings: [] });
    } else
      http
        .expectOne("/api/auth/me")
        .flush({}, { status: 401, statusText: "Unauthorized" });
    const slot = {
      startsAt: app.today + "T13:00:00.000Z",
      endsAt: app.today + "T13:30:00.000Z",
    };
    fixture.detectChanges();
    return { fixture, http, app, slot };
  }
  it("registro crea sesión, borra contraseña y carga solo mis citas", () => {
    const { app, http } = setup(false);
    app.registering.set(true);
    app.name = user.name;
    app.email = user.email;
    app.password = "Contraseña-de-prueba";
    app.authenticate();
    const request = http.expectOne("/api/auth/register");
    expect(request.request.headers.get("X-Agenda-Request")).toBe("1");
    request.flush({ user });
    http.expectOne("/api/bookings").flush({ bookings: [] });
    expect(app.user()?.name).toBe(user.name);
    expect(app.password).toBe("");
  });
  it("seleccionar horario no reserva y visitante debe iniciar sesión", () => {
    const { app, http, fixture, slot } = setup(false);
    app.choose(service);
    app.pickSlot(slot);
    app.reserve();
    http.expectNone("/api/bookings");
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Inicia sesión o crea una cuenta arriba",
    );
  });
  it("confirmación envía solo servicio e inicio, evita doble envío y actualiza citas", () => {
    const { app, http, slot, fixture } = setup();
    app.choose(service);
    app.pickSlot(slot);
    app.reserve();
    app.reserve();
    const request = http.expectOne("/api/bookings");
    expect(request.request.body).toEqual({
      serviceId: 1,
      startsAt: slot.startsAt,
    });
    request.flush({
      booking: {
        id: 7,
        serviceName: service.name,
        status: "confirmed",
        ...slot,
      },
    });
    http
      .expectOne("/api/bookings")
      .flush({
        bookings: [
          { id: 7, serviceName: service.name, status: "confirmed", ...slot },
        ],
      });
    http.expectOne((r) => r.url.endsWith("/availability")).flush({ slots: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Reserva #7 confirmada",
    );
    expect(app.bookings().length).toBe(1);
    expect(app.chosenSlot()).toBe(null);
  });
  it("un conflicto elimina cupos obsoletos sin afirmar confirmación", () => {
    const { app, http, slot } = setup();
    app.choose(service);
    app.slots.set([slot]);
    app.checked.set(true);
    app.pickSlot(slot);
    app.reserve();
    http
      .expectOne("/api/bookings")
      .flush(
        { message: "Otra persona reservó el horario." },
        { status: 409, statusText: "Conflict" },
      );
    expect(app.error()).toContain("Otra persona");
    expect(app.confirmation()).toBe("");
    expect(app.slots()).toEqual([]);
    expect(app.bookingBusy()).toBe(false);
  });
  it("sesión vencida borra citas de pantalla y pide iniciar sesión", () => {
    const { app, http, slot } = setup();
    app.choose(service);
    app.pickSlot(slot);
    app.reserve();
    http
      .expectOne("/api/bookings")
      .flush(
        { message: "Sesión vencida" },
        { status: 401, statusText: "Unauthorized" },
      );
    expect(app.user()).toBe(null);
    expect(app.bookings()).toEqual([]);
    expect(app.authError()).toContain("Vuelve a iniciar sesión");
  });
  it("cerrar sesión ignora una respuesta de citas anterior", () => {
    const { app, http, slot } = setup();
    app.loadBookings();
    const old = http.expectOne("/api/bookings");
    app.logout();
    http
      .expectOne("/api/auth/logout")
      .flush(null, { status: 204, statusText: "No Content" });
    old.flush({
      bookings: [
        { id: 2, serviceName: "Privado", status: "confirmed", ...slot },
      ],
    });
    expect(app.user()).toBe(null);
    expect(app.bookings()).toEqual([]);
  });
  it("recargar restaura la sesión y consulta citas persistidas", () => {
    const fixture = TestBed.createComponent(App),
      http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/services").flush({ services: [service] });
    http.expectOne("/api/auth/me").flush({ user });
    http
      .expectOne("/api/bookings")
      .flush({
        bookings: [
          {
            id: 3,
            serviceName: "Consulta",
            status: "confirmed",
            startsAt: "2026-11-12T13:00:00Z",
            endsAt: "2026-11-12T13:30:00Z",
          },
        ],
      });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Reserva #3");
  });
});
