import { Component, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { Manager } from "./manager";
import { Settings } from "./settings";
export interface Service {
  id: number;
  name: string;
  description: string;
  durationMinutes: number;
}
interface Slot {
  startsAt: string;
  endsAt: string;
}
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}
interface Booking extends Slot {
  id: number;
  serviceName: string;
  status: string;
  canCancel?: boolean;
}
@Component({
  selector: "app-root",
  imports: [FormsModule, DatePipe, Manager, Settings],
  templateUrl: "./app.html",
  styleUrl: "./app.css",
})
export class App {
  private http = inject(HttpClient);
  services = signal<Service[]>([]);
  selected = signal<Service | null>(null);
  slots = signal<Slot[]>([]);
  loading = signal(true);
  searching = signal(false);
  error = signal("");
  checked = signal(false);
  date = signal("");
  user = signal<User | null>(null);
  sessionLoading = signal(true);
  authBusy = signal(false);
  authError = signal("");
  registering = signal(false);
  name = "";
  email = "";
  password = "";
  bookings = signal<Booking[]>([]);
  bookingsLoading = signal(false);
  bookingsError = signal("");
  chosenSlot = signal<Slot | null>(null);
  bookingBusy = signal(false);
  confirmation = signal("");
  cancelTarget = signal<Booking | null>(null);
  cancelling = signal(false);
  cancellationNotice = signal("");
  managerBusy = signal(false);
  settingsOpen = signal(false);
  settingsBusy = signal(false);
  configurationChanged() {
    this.selected.set(null);
    this.clearResults();
    this.load();
  }
  private sessionVersion = 0;
  private bookingsRequest = 0;
  private readonly mutation = { headers: { "X-Agenda-Request": "1" } };
  readonly today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  readonly lastDay = (() => {
    const d = new Date(this.today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  private requestId = 0;
  constructor() {
    this.date.set(this.today);
    this.load();
    this.restoreSession();
  }
  private restoreSession() {
    this.http.get<{ user: User }>("/api/auth/me").subscribe({
      next: (r) => {
        this.user.set(r.user);
        this.sessionLoading.set(false);
        this.loadBookings();
      },
      error: (e) => {
        this.sessionLoading.set(false);
        if (e.status !== 401)
          this.authError.set(
            "No se pudo comprobar tu sesión. Vuelve a cargar la página.",
          );
      },
    });
  }
  authenticate() {
    if (this.authBusy() || this.sessionLoading()) return;
    this.authBusy.set(true);
    this.authError.set("");
    this.http
      .post<{ user: User }>(
        `/api/auth/${this.registering() ? "register" : "login"}`,
        { name: this.name, email: this.email, password: this.password },
        this.mutation,
      )
      .subscribe({
        next: (r) => {
          this.sessionVersion++;
          this.user.set(r.user);
          this.password = "";
          this.authBusy.set(false);
          this.loadBookings();
        },
        error: (e) => {
          this.authBusy.set(false);
          this.password = "";
          this.authError.set(this.message(e));
        },
      });
  }
  logout() {
    if (
      this.authBusy() ||
      this.bookingBusy() ||
      this.cancelling() ||
      this.managerBusy() ||
      this.settingsBusy()
    )
      return;
    this.authBusy.set(true);
    this.authError.set("");
    this.http.post("/api/auth/logout", {}, this.mutation).subscribe({
      next: () => {
        this.sessionVersion++;
        this.user.set(null);
        this.bookings.set([]);
        this.bookingsLoading.set(false);
        this.bookingsError.set("");
        this.cancelTarget.set(null);
        this.cancellationNotice.set("");
        this.settingsOpen.set(false);
        this.chosenSlot.set(null);
        this.confirmation.set("");
        this.authBusy.set(false);
      },
      error: (e) => {
        this.authBusy.set(false);
        this.authError.set(this.message(e));
      },
    });
  }
  loadBookings() {
    if (!this.user() || this.cancelling()) return;
    const version = this.sessionVersion;
    const request = ++this.bookingsRequest;
    this.bookingsLoading.set(true);
    this.bookingsError.set("");
    this.http.get<{ bookings: Booking[] }>("/api/bookings").subscribe({
      next: (r) => {
        if (version !== this.sessionVersion || request !== this.bookingsRequest)
          return;
        this.bookings.set(r.bookings);
        this.bookingsLoading.set(false);
      },
      error: (e) => {
        if (version !== this.sessionVersion || request !== this.bookingsRequest)
          return;
        this.bookingsLoading.set(false);
        this.bookingsError.set(this.message(e));
        if (e.status === 401) this.expired();
      },
    });
  }
  statusLabel(status: string) {
    return (
      (
        {
          confirmed: "Confirmada",
          cancelled: "Cancelada",
          attended: "Atendida",
          missed: "No asistió",
        } as Record<string, string>
      )[status] ?? status
    );
  }
  askCancel(booking: Booking) {
    if (
      !booking.canCancel ||
      this.cancelling() ||
      this.bookingBusy() ||
      this.authBusy()
    )
      return;
    this.cancelTarget.set(booking);
    this.cancellationNotice.set("");
  }
  cancelBooking() {
    const target = this.cancelTarget();
    if (!target || this.cancelling() || this.authBusy() || this.bookingBusy())
      return;
    this.bookingsRequest++;
    this.bookingsLoading.set(false);
    this.cancelling.set(true);
    this.bookingsError.set("");
    this.http
      .post(`/api/bookings/${target.id}/cancel`, {}, this.mutation)
      .subscribe({
        next: () => {
          this.cancelling.set(false);
          this.cancelTarget.set(null);
          this.cancellationNotice.set(
            `Cita #${target.id} cancelada. Su horario vuelve a estar disponible.`,
          );
          this.loadBookings();
          this.clearResults();
        },
        error: (e) => {
          this.cancelling.set(false);
          this.cancelTarget.set(null);
          this.bookingsError.set(this.message(e));
          if (e.status === 401) this.expired();
        },
      });
  }
  pickSlot(slot: Slot) {
    if (this.bookingBusy()) return;
    this.chosenSlot.set(slot);
    this.confirmation.set("");
  }
  reserve() {
    const service = this.selected(),
      slot = this.chosenSlot();
    if (
      !service ||
      !slot ||
      !this.user() ||
      this.bookingBusy() ||
      this.cancelling() ||
      this.authBusy()
    )
      return;
    this.bookingBusy.set(true);
    this.error.set("");
    this.confirmation.set("");
    this.http
      .post<{ booking: Booking }>(
        "/api/bookings",
        { serviceId: service.id, startsAt: slot.startsAt },
        this.mutation,
      )
      .subscribe({
        next: (r) => {
          this.bookingBusy.set(false);
          this.chosenSlot.set(null);
          this.confirmation.set(
            `Reserva #${r.booking.id} confirmada. Puedes verla en Mis citas.`,
          );
          this.loadBookings();
          this.search();
        },
        error: (e) => {
          this.bookingBusy.set(false);
          this.chosenSlot.set(null);
          if (e.status === 401) this.expired();
          if (e.status === 409) {
            this.slots.set([]);
            this.checked.set(false);
          }
          this.error.set(this.message(e));
        },
      });
  }
  private expired() {
    this.sessionVersion++;
    this.user.set(null);
    this.bookings.set([]);
    this.cancelTarget.set(null);
    this.authError.set("Tu sesión terminó. Vuelve a iniciar sesión.");
  }
  private message(e: HttpErrorResponse) {
    return e.status === 0 || e.status >= 500
      ? "No pudimos conectar con la agenda. Comprueba que el servicio esté iniciado y vuelve a intentar."
      : typeof e.error?.message === "string"
        ? e.error.message
        : "No se pudo completar la operación.";
  }
  load() {
    this.error.set("");
    this.loading.set(true);
    this.http.get<{ services: Service[] }>("/api/services").subscribe({
      next: (r) => {
        this.services.set(r.services);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.fail(e);
      },
    });
  }
  choose(service: Service) {
    if (this.bookingBusy()) return;
    this.selected.set(service);
    this.confirmation.set("");
    this.clearResults();
  }
  changeDate(date: string) {
    if (this.bookingBusy()) return;
    this.date.set(date);
    this.confirmation.set("");
    this.clearResults();
  }
  private clearResults() {
    this.requestId++;
    this.chosenSlot.set(null);
    this.slots.set([]);
    this.checked.set(false);
    this.searching.set(false);
    this.error.set("");
  }
  search() {
    const service = this.selected();
    if (!service || this.searching() || this.bookingBusy()) return;
    this.clearResults();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(this.date()) ||
      this.date() < this.today ||
      this.date() > this.lastDay
    ) {
      this.error.set("Elige una fecha entre hoy y los próximos 90 días.");
      return;
    }
    const request = ++this.requestId;
    this.searching.set(true);
    this.http
      .get<{ slots: Slot[] }>(`/api/services/${service.id}/availability`, {
        params: { date: this.date() },
      })
      .subscribe({
        next: (r) => {
          if (request !== this.requestId) return;
          this.slots.set(r.slots);
          this.checked.set(true);
          this.searching.set(false);
        },
        error: (e) => {
          if (request !== this.requestId) return;
          this.searching.set(false);
          this.fail(e);
        },
      });
  }
  private fail(e: HttpErrorResponse) {
    this.error.set(this.message(e));
  }
}
