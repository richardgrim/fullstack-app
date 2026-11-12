import { Component, inject, signal, output } from "@angular/core";
import { DatePipe } from "@angular/common";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
interface Appointment {
  id: number;
  serviceName: string;
  clientName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  canComplete: boolean;
}
@Component({
  selector: "app-manager",
  imports: [FormsModule, DatePipe],
  templateUrl: "./manager.html",
  styleUrl: "./manager.css",
})
export class Manager {
  private http = inject(HttpClient);
  readonly busyChange = output<boolean>();
  date = signal(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/La_Paz",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  status = signal("");
  appointments = signal<Appointment[]>([]);
  loading = signal(false);
  saving = signal(false);
  error = signal("");
  notice = signal("");
  pending = signal<{
    appointment: Appointment;
    status: "attended" | "missed";
  } | null>(null);
  private request = 0;
  constructor() {
    this.load();
  }
  label(status: string) {
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
  filter(date: string, status: string) {
    if (this.saving()) return;
    this.date.set(date);
    this.status.set(status);
    this.pending.set(null);
    this.notice.set("");
    this.load();
  }
  load() {
    if (this.saving()) return;
    const request = ++this.request;
    this.error.set("");
    this.appointments.set([]);
    this.pending.set(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date())) {
      this.loading.set(false);
      this.error.set("Selecciona una fecha válida.");
      return;
    }
    this.loading.set(true);
    const params: Record<string, string> = { date: this.date() };
    if (this.status()) params["status"] = this.status();
    this.http
      .get<{ bookings: Appointment[] }>("/api/management/agenda", { params })
      .subscribe({
        next: (r) => {
          if (request !== this.request) return;
          this.appointments.set(r.bookings);
          this.loading.set(false);
        },
        error: (e) => {
          if (request !== this.request) return;
          this.loading.set(false);
          this.error.set(this.message(e));
        },
      });
  }
  choose(appointment: Appointment, status: "attended" | "missed") {
    if (this.saving() || !appointment.canComplete) return;
    this.pending.set({ appointment, status });
    this.notice.set("");
  }
  confirm() {
    const choice = this.pending();
    if (!choice || this.saving()) return;
    this.saving.set(true);
    this.busyChange.emit(true);
    this.error.set("");
    this.http
      .post(
        `/api/management/bookings/${choice.appointment.id}/outcome`,
        { status: choice.status },
        { headers: { "X-Agenda-Request": "1" } },
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.busyChange.emit(false);
          this.pending.set(null);
          this.notice.set(
            `Cita #${choice.appointment.id}: ${this.label(choice.status)}.`,
          );
          this.load();
        },
        error: (e) => {
          this.saving.set(false);
          this.busyChange.emit(false);
          this.pending.set(null);
          this.error.set(this.message(e));
        },
      });
  }
  private message(e: HttpErrorResponse) {
    return e.status === 0 || e.status >= 500
      ? "No se pudo conectar con la agenda. Intenta nuevamente."
      : typeof e.error?.message === "string"
        ? e.error.message
        : "No se pudo completar la operación.";
  }
}
