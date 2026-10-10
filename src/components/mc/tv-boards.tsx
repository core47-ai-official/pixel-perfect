import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Ltr } from "@/components/mc/ltr";
import i18n from "@/i18n";

/* Public LCD boards: cashier counter, pharmacy pickup, operations wallboard.
   Data only from get-tv-board (display-token gated, no patient names). */

const en = (k: string, o: Record<string, unknown> = {}) => i18n.getFixedT("en")(`queue.${k}`, o) as string;
const ur = (k: string, o: Record<string, unknown> = {}) => i18n.getFixedT("ur")(`queue.${k}`, o) as string;
const Both = ({ k, o, className = "" }: { k: string; o?: Record<string, unknown>; className?: string }) => (
  <span className={className}>{en(k, o)} · <span className="font-urdu">{ur(k, o)}</span></span>
);
const pkr = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

interface Head { hospital_id: string; hospital_name: string; logo: string | null }

function useBoard<T extends Head>(board: string, token: string, extra: Record<string, unknown> = {}, every = 10_000) {
  const q = useQuery({
    queryKey: ["tv-board", board, token, extra],
    enabled: token.length >= 8,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-tv-board", { body: { display_token: token, board, ...extra } });
      if (error || data?.ok === false) throw new Error("bad");
      return data.data as T;
    },
    refetchInterval: every, retry: 1,
  });
  const hid = q.data?.hospital_id;
  const refetch = q.refetch;
  useEffect(() => {
    if (!hid) return;
    const ch = supabase.channel(`tv-${hid}-${board}-${Math.random().toString(36).slice(2)}`);
    ch.on("broadcast", { event: "refresh" }, () => { void refetch(); }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hid, board, refetch]);
  return q;
}

function Shell({ head, title, children, footer }: { head: Head; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const h = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(h); }, []);
  return (
    <div className="flex min-h-screen flex-col bg-background p-8 text-foreground">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          {head.logo && <img src={head.logo} alt="" className="h-16 w-auto" />}
          <div>
            <h1 className="text-4xl font-bold">{head.hospital_name}</h1>
            <p className="text-2xl text-muted-foreground">{title}</p>
          </div>
        </div>
        <Ltr className="text-4xl font-semibold tabular-nums">{now ? new Date(now.getTime() + 5 * 3600_000).toISOString().slice(11, 16) : ""}</Ltr>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      {footer && <footer className="mt-6 text-center text-2xl text-muted-foreground">{footer}</footer>}
    </div>
  );
}

function State({ q, token }: { q: { isError: boolean; data: unknown }; token: string }) {
  if (q.isError || token.length < 8) return <Center><p className="text-3xl">{en("tvBad")}</p><p className="font-urdu text-3xl" dir="rtl">{ur("tvBad")}</p></Center>;
  return <Center><p className="text-3xl">{en("tvLoading")}</p></Center>;
}
function Center({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">{children}</div>;
}

/* ---------- Cashier counter ---------- */
interface Bill {
  invoice_no: string; token_no: number | null; receipt_no: string;
  lines: { description: string; qty: number; rate: number; amount: number }[];
  total: number; discount: number; paid: number; balance: number; amount: number; tendered: number | null; change: number;
}
interface BillingData extends Head { counter_open: boolean; cashier_name: string | null; bill: Bill | null }

export function TvBillingScreen({ counterId, token }: { counterId: string; token: string }) {
  const q = useBoard<BillingData>("billing", token, { counter_id: counterId }, 5_000);
  if (!q.data) return <State q={q} token={token} />;
  const d = q.data, bill = d.bill;
  return (
    <Shell head={d} title={<><Both k="bbCounter" />{d.cashier_name ? ` — ${d.cashier_name}` : ""}</>} footer={bill ? <Both k="bbCountChange" /> : null}>
      {!d.counter_open ? (
        <div className="flex flex-1 items-center justify-center"><Both k="bbClosed" className="text-5xl font-semibold text-muted-foreground" /></div>
      ) : !bill ? (
        <div className="flex flex-1 items-center justify-center"><Both k="bbWelcome" className="text-5xl font-semibold" /></div>
      ) : (
        <div className="grid flex-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-baseline justify-between text-2xl text-muted-foreground">
              <Ltr>{bill.invoice_no}</Ltr>
              {bill.token_no != null && <span className="font-semibold text-foreground"><Both k="bbToken" o={{ token: bill.token_no }} /></span>}
            </div>
            <table className="w-full text-2xl">
              <thead className="border-b text-xl text-muted-foreground">
                <tr><th className="py-2 text-start">{en("bbItem")}</th><th className="text-end">{en("bbQty")}</th><th className="text-end">{en("bbAmount")}</th></tr>
              </thead>
              <tbody className="divide-y">
                {bill.lines.slice(0, 12).map((l, i) => (
                  <tr key={i}><td className="py-2">{l.description}</td><td className="text-end tabular-nums"><Ltr>{l.qty}</Ltr></td><td className="text-end tabular-nums"><Ltr>{pkr(l.amount)}</Ltr></td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="flex flex-col gap-4">
            <Sum k="bbTotal" v={bill.total} />
            {bill.discount > 0 && <Sum k="bbDiscount" v={-bill.discount} />}
            <Sum k="bbPaidNow" v={bill.amount} strong />
            {bill.change > 0 && <Sum k="bbChange" v={bill.change} strong />}
            <Sum k="bbBalance" v={bill.balance} tone={bill.balance > 0 ? "warn" : "ok"} />
          </section>
        </div>
      )}
    </Shell>
  );
}
function Sum({ k, v, strong, tone }: { k: string; v: number; strong?: boolean; tone?: "ok" | "warn" }) {
  const cls = tone === "warn" ? "text-destructive" : tone === "ok" || strong ? "text-primary" : "";
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <Both k={k} className="text-xl text-muted-foreground" />
      <Ltr className={`block text-5xl font-bold tabular-nums ${cls}`}>{pkr(v)}</Ltr>
    </div>
  );
}

/* ---------- Pharmacy pickup ---------- */
interface PharmacyData extends Head { preparing: number[]; ready: { token_no: number; at: string }[] }

export function TvPharmacyScreen({ token }: { token: string }) {
  const q = useBoard<PharmacyData>("pharmacy", token);
  if (!q.data) return <State q={q} token={token} />;
  const d = q.data;
  const fresh = (at: string) => Date.now() - new Date(at).getTime() < 2 * 60_000;
  return (
    <Shell head={d} title={<Both k="tvPharmacy" />} footer={<Both k="phHint" />}>
      <div className="grid flex-1 gap-6 md:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-3xl font-semibold text-muted-foreground"><Both k="phPreparing" /></h2>
          <div className="flex flex-wrap gap-4">
            {d.preparing.map((n) => <Ltr key={n} className="rounded-xl border px-6 py-3 text-6xl font-semibold tabular-nums">{n}</Ltr>)}
            {d.preparing.length === 0 && <span className="text-3xl text-muted-foreground">—</span>}
          </div>
        </section>
        <section className="rounded-2xl border bg-primary/10 p-6 shadow-sm">
          <h2 className="mb-4 text-3xl font-semibold text-primary"><Both k="phReady" /></h2>
          <div className="flex flex-wrap gap-4">
            {d.ready.map((r) => (
              <Ltr key={r.token_no} className={`rounded-xl bg-primary px-6 py-3 text-7xl font-bold tabular-nums text-primary-foreground ${fresh(r.at) ? "animate-pulse" : ""}`}>{r.token_no}</Ltr>
            ))}
            {d.ready.length === 0 && <span className="text-3xl text-muted-foreground">—</span>}
          </div>
        </section>
      </div>
    </Shell>
  );
}

/* ---------- Operations wallboard ---------- */
interface OpsData extends Head {
  wards: { id: string; name: string; total: number; occupied: number; available: number }[];
  er: Record<string, number>; opd: Record<string, number>; lab: Record<string, number>;
}

export function TvOpsScreen({ token }: { token: string }) {
  const q = useBoard<OpsData>("ops", token, {}, 30_000);
  if (!q.data) return <State q={q} token={token} />;
  const d = q.data;
  const g = (m: Record<string, number>, ...k: string[]) => k.reduce((s, x) => s + (m[x] ?? 0), 0);
  return (
    <Shell head={d} title={<Both k="opsTitle" />}>
      <div className="grid flex-1 gap-6 xl:grid-cols-[3fr_2fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-3xl font-semibold"><Both k="opsBeds" /></h2>
          <div className="grid gap-4 md:grid-cols-2">
            {d.wards.map((w) => {
              const pct = w.total ? Math.round((w.occupied / w.total) * 100) : 0;
              return (
                <div key={w.id} className="rounded-xl border p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-medium">{w.name}</span>
                    <Ltr className="text-3xl font-bold tabular-nums">{w.occupied}/{w.total}</Ltr>
                  </div>
                  <div className="my-2 h-3 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xl text-muted-foreground">{en("opsFree", { n: w.available })}</span>
                </div>
              );
            })}
          </div>
        </section>
        <div className="flex flex-col gap-6">
          <Tiles k="opsEr" items={[
            ["opsRed", g(d.er, "red"), "bg-destructive text-destructive-foreground"],
            ["opsOrange", g(d.er, "orange"), "bg-warning text-warning-foreground"],
            ["opsYellow", g(d.er, "yellow"), "bg-accent text-accent-foreground"],
            ["opsGreen", g(d.er, "green"), "bg-primary text-primary-foreground"],
            ["opsUntriaged", g(d.er, "none"), "bg-muted"],
          ]} />
          <Tiles k="opsOpd" items={[
            ["opsBooked", g(d.opd, "booked"), "bg-muted"],
            ["opsWaiting", g(d.opd, "waiting"), "bg-muted"],
            ["opsWithDoctor", g(d.opd, "in_consultation"), "bg-primary/15"],
            ["opsDone", g(d.opd, "completed"), "bg-primary/15"],
          ]} />
          <Tiles k="opsLab" items={[
            ["opsOrdered", g(d.lab, "ordered", "rejected"), "bg-muted"],
            ["opsCollected", g(d.lab, "collected"), "bg-muted"],
            ["opsResulted", g(d.lab, "resulted"), "bg-primary/15"],
            ["opsVerified", g(d.lab, "verified"), "bg-primary/15"],
          ]} />
        </div>
      </div>
    </Shell>
  );
}
function Tiles({ k, items }: { k: string; items: [string, number, string][] }) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-3xl font-semibold"><Both k={k} /></h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(([lk, n, cls]) => (
          <div key={lk} className={`rounded-xl p-3 text-center ${cls}`}>
            <Ltr className="block text-5xl font-bold tabular-nums">{n}</Ltr>
            <span className="text-lg">{en(lk)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
