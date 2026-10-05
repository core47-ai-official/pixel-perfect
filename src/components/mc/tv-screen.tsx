import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Ltr } from "@/components/mc/ltr";
import i18n from "@/i18n";

interface TvDoctor { id: string; name: string; specialty: string; room: string | null; now_serving: number | null; waiting: number[]; waiting_count: number }
interface TvData { hospital_id: string; hospital_name: string; logo: string | null; title: string | null; avg_consult_minutes: number; doctors: TvDoctor[] }

const en = (k: string, o?: Record<string, unknown>) => i18n.getFixedT("en")(k, o);
const ur = (k: string, o?: Record<string, unknown>) => i18n.getFixedT("ur")(k, o);

/** Full-screen waiting-room display. Public; protected by the display token. Shows token numbers only. */
export function TvScreen({ doctorId, departmentId, token }: { doctorId?: string; departmentId?: string; token: string }) {
  const q = useQuery({
    queryKey: ["tv", doctorId, departmentId, token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-tv-queue", {
        body: { display_token: token, doctor_id: doctorId, department_id: departmentId },
      });
      if (error || data?.ok === false) throw new Error("bad");
      return data.data as TvData;
    },
    refetchInterval: 15_000, retry: 1,
  });
  const hid = q.data?.hospital_id;
  const refetch = q.refetch;
  useEffect(() => {
    if (!hid) return;
    const ch = supabase.channel(`tv-${hid}`).on("broadcast", { event: "refresh" }, () => { void refetch(); }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hid, refetch]);

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const h = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(h); }, []);

  if (q.isError || !token) return <Center><p className="text-3xl">{en("queue.tvBad")}</p><p className="font-urdu text-3xl" dir="rtl">{ur("queue.tvBad")}</p></Center>;
  if (!q.data) return <Center><p className="text-3xl">{en("queue.tvLoading")}</p></Center>;
  const d = q.data;
  const many = d.doctors.length > 1;
  return (
    <div className="flex min-h-screen flex-col bg-background p-8 text-foreground">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          {d.logo && <img src={d.logo} alt="" className="h-16 w-auto" />}
          <div>
            <h1 className="text-4xl font-bold">{d.hospital_name}</h1>
            {d.title && <p className="text-2xl text-muted-foreground">{d.title}</p>}
          </div>
        </div>
        <Ltr className="text-4xl font-semibold tabular-nums">{now ? new Date(now.getTime() + 5 * 3600_000).toISOString().slice(11, 16) : ""}</Ltr>
      </header>
      <main className={`grid flex-1 gap-6 ${many ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}>
        {d.doctors.map((doc) => (
          <section key={doc.id} className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm">
            <h2 className={many ? "text-3xl font-semibold" : "text-5xl font-semibold"}>{doc.name}</h2>
            <p className="text-xl text-muted-foreground">{doc.specialty}{doc.room ? ` · ${en("queue.room", { room: doc.room })}` : ""}</p>
            <div className="my-6 flex flex-1 flex-col items-center justify-center rounded-xl bg-primary/10 py-6">
              <p className="text-2xl">{en("queue.nowServing")} · <span className="font-urdu">{ur("queue.nowServing")}</span></p>
              <Ltr className={`font-bold text-primary tabular-nums leading-none ${many ? "text-[7rem]" : "text-[14rem]"}`}>{doc.now_serving ?? "—"}</Ltr>
            </div>
            <p className="mb-2 text-xl text-muted-foreground">{en("queue.tvNext")} · <span className="font-urdu">{ur("queue.tvNext")}</span></p>
            <div className="flex flex-wrap gap-3">
              {doc.waiting.slice(0, many ? 6 : 12).map((n) => (
                <Ltr key={n} className={`rounded-lg border px-4 py-2 font-semibold tabular-nums ${many ? "text-3xl" : "text-5xl"}`}>{n}</Ltr>
              ))}
              {doc.waiting.length === 0 && <span className="text-2xl text-muted-foreground">—</span>}
            </div>
          </section>
        ))}
      </main>
      <footer className="mt-6 text-center text-xl text-muted-foreground">
        {en("queue.tvWait", { min: d.avg_consult_minutes })} · <span className="font-urdu">{ur("queue.tvWait", { min: d.avg_consult_minutes })}</span>
      </footer>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">{children}</div>;
}
