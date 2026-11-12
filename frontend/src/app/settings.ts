import { Component, inject, signal, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
interface Service {
  id: number;
  name: string;
  description: string;
  durationMinutes: number;
  active: boolean;
}
interface Period {
  opens: string;
  closes: string;
}
interface Hours extends Period {
  weekday: number;
}
interface Block {
  id: number;
  startsAt: string;
  endsAt: string;
}
interface Configuration {
  services: Service[];
  hours: Hours[];
  blocks: Block[];
}
@Component({
  selector: "app-settings",
  imports: [FormsModule, DatePipe],
  templateUrl: "./settings.html",
  styleUrl: "./settings.css",
})
export class Settings {
  private http = inject(HttpClient);
  readonly busyChange = output<boolean>();
  readonly changed = output<void>();
  config = signal<Configuration | null>(null);
  loading = signal(false);
  saving = signal(false);
  error = signal("");
  notice = signal("");
  pending = signal<{ path: string; body: unknown; summary: string } | null>(
    null,
  );
  serviceId: number | null = null;
  serviceName = "";
  description = "";
  duration = 30;
  active = true;
  weekday = 1;
  periods: Period[] = [];
  blockDate = "";
  blockOpens = "09:00";
  blockCloses = "10:00";
  readonly days = [
    { id: 1, name: "Lunes" },
    { id: 2, name: "Martes" },
    { id: 3, name: "Miércoles" },
    { id: 4, name: "Jueves" },
    { id: 5, name: "Viernes" },
    { id: 6, name: "Sábado" },
    { id: 0, name: "Domingo" },
  ];
  constructor() {
    this.load();
  }
  load() {
    if (this.saving()) return;
    this.loading.set(true);
    this.error.set("");
    this.pending.set(null);
    this.http.get<Configuration>("/api/management/settings").subscribe({
      next: (r) => {
        this.config.set(r);
        this.loadDay(this.weekday);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(this.message(e));
      },
    });
  }
  edit(service: Service | null) {
    if (this.saving() || this.loading()) return;
    this.pending.set(null);
    this.serviceId = service?.id ?? null;
    this.serviceName = service?.name ?? "";
    this.description = service?.description ?? "";
    this.duration = service?.durationMinutes ?? 30;
    this.active = service?.active ?? true;
  }
  loadDay(day: number) {
    this.weekday = Number(day);
    this.periods = (this.config()?.hours ?? [])
      .filter((h) => h.weekday === this.weekday)
      .map((h) => ({ opens: h.opens, closes: h.closes }));
    this.pending.set(null);
  }
  addPeriod() {
    if (this.periods.length < 8)
      this.periods = [...this.periods, { opens: "09:00", closes: "12:00" }];
  }
  removePeriod(index: number) {
    this.periods = this.periods.filter((_, i) => i !== index);
  }
  stageService() {
    this.stage(
      "services" + (this.serviceId === null ? "" : "/" + this.serviceId),
      {
        name: this.serviceName,
        description: this.description,
        durationMinutes: Number(this.duration),
        active: this.active,
      },
      `${this.serviceId === null ? "Crear" : "Actualizar"} «${this.serviceName}»: ${this.duration} minutos, ${this.active ? "disponible" : "inactivo"}. Las citas existentes conservarán su información.`,
    );
  }
  stageHours() {
    this.stage(
      "hours/" + this.weekday,
      { periods: this.periods.map((p) => ({ ...p })) },
      `Guardar horario de ${this.days.find((d) => d.id === this.weekday)?.name}: ${this.periods.length ? this.periods.map((p) => p.opens + "–" + p.closes).join(", ") : "cerrado"}. Se rechazará el cambio si deja citas confirmadas fuera de atención.`,
    );
  }
  stageBlock() {
    this.stage(
      "blocks",
      {
        date: this.blockDate,
        opens: this.blockOpens,
        closes: this.blockCloses,
      },
      `Bloquear el ${this.blockDate} de ${this.blockOpens} a ${this.blockCloses}, hora de Bolivia. No se podrá reservar durante ese intervalo.`,
    );
  }
  stageRemove(block: Block) {
    this.stage(
      `blocks/${block.id}/remove`,
      {},
      `Quitar el bloqueo #${block.id}. Se volverán a ofrecer los horarios que cumplan el resto de las reglas de la agenda.`,
    );
  }
  private stage(path: string, body: unknown, summary: string) {
    if (this.saving() || this.loading()) return;
    this.notice.set("");
    this.error.set("");
    this.pending.set({ path, body, summary });
  }
  confirm() {
    const change = this.pending();
    if (!change || this.saving()) return;
    this.saving.set(true);
    this.busyChange.emit(true);
    this.error.set("");
    this.http
      .post("/api/management/settings/" + change.path, change.body, {
        headers: { "X-Agenda-Request": "1" },
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.busyChange.emit(false);
          this.pending.set(null);
          this.notice.set(
            "Cambio guardado. Las citas existentes se conservaron.",
          );
          this.changed.emit();
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
      ? "No se pudo conectar con la configuración. Intenta nuevamente."
      : typeof e.error?.message === "string"
        ? e.error.message
        : "No se pudo guardar el cambio.";
  }
}
