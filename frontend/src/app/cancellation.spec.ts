import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { App } from "./app";
const booking = {
  id: 9,
  serviceName: "Consulta",
  startsAt: "2026-11-12T13:00:00Z",
  endsAt: "2026-11-12T13:30:00Z",
  status: "confirmed",
  canCancel: true,
};
describe("Cancelación de citas", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function setup() {
    const fixture = TestBed.createComponent(App),
      http = TestBed.inject(HttpTestingController),
      app = fixture.componentInstance;
    http.expectOne("/api/services").flush({ services: [] });
    http
      .expectOne("/api/auth/me")
      .flush({
        user: {
          id: 1,
          name: "Alicia",
          email: "alicia@example.test",
          role: "client",
        },
      });
    http.expectOne("/api/bookings").flush({ bookings: [booking] });
    fixture.detectChanges();
    return { fixture, http, app };
  }
  it("ofrece cancelar solo citas permitidas y mantiene oculto el panel de responsable", () => {
    const { fixture, app } = setup();
    expect(fixture.nativeElement.textContent).toContain("Cancelar cita");
    expect(fixture.nativeElement.textContent).not.toContain(
      "Agenda del responsable",
    );
    app.bookings.set([{ ...booking, canCancel: false }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain("Cancelar cita");
  });
  it("pedir cancelación no escribe hasta confirmar; doble clic envía una sola petición", () => {
    const { http, app } = setup();
    app.askCancel(booking);
    http.expectNone((r) => r.method === "POST");
    app.cancelBooking();
    app.cancelBooking();
    const req = http.expectOne("/api/bookings/9/cancel");
    expect(req.request.headers.get("X-Agenda-Request")).toBe("1");
    req.flush({ booking: { id: 9, status: "cancelled" } });
    http
      .expectOne("/api/bookings")
      .flush({
        bookings: [{ ...booking, status: "cancelled", canCancel: false }],
      });
    expect(app.bookings()[0].status).toBe("cancelled");
    expect(app.cancellationNotice()).toContain("cancelada");
    expect(app.checked()).toBe(false);
  });
  it("conflicto conserva historial y explica que no se pudo cancelar", () => {
    const { http, app } = setup();
    app.askCancel(booking);
    app.cancelBooking();
    http
      .expectOne("/api/bookings/9/cancel")
      .flush(
        { message: "La cita ya comenzó." },
        { status: 409, statusText: "Conflict" },
      );
    expect(app.bookingsError()).toBe("La cita ya comenzó.");
    expect(app.bookings()[0].status).toBe("confirmed");
    expect(app.cancellationNotice()).toBe("");
  });
  it("respuesta antigua no restaura una cita cancelada", () => {
    const { http, app } = setup();
    app.loadBookings();
    const old = http.expectOne("/api/bookings");
    app.askCancel(booking);
    app.cancelBooking();
    http
      .expectOne("/api/bookings/9/cancel")
      .flush({ booking: { id: 9, status: "cancelled" } });
    http
      .expectOne("/api/bookings")
      .flush({
        bookings: [{ ...booking, status: "cancelled", canCancel: false }],
      });
    old.flush({ bookings: [booking] });
    expect(app.bookings()[0].status).toBe("cancelled");
  });
});
