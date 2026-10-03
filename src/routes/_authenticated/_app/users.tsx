import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { StatusChip } from "@/components/mc/status-chip";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PhoneInput } from "@/components/mc/masked-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext, type AppRole } from "@/hooks/use-my-context";
import { setImpersonation } from "@/lib/impersonation";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/users")({
  head: () => ({ meta: [{ title: "Users — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("users")}>
      <UsersPage />
    </RequireRole>
  ),
});

const ALL_ROLES: AppRole[] = [
  "super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer",
  "ot_coordinator", "receptionist", "pharmacist", "lab_tech", "cashier",
];
/** Staff roles an admin (not super_admin) may grant or manage. */
const BELOW_ADMIN: AppRole[] = ALL_ROLES.filter((r) => r !== "super_admin" && r !== "admin");
const NEEDS_DEPT: AppRole[] = ["dept_head", "doctor"];

type RoleRow = { role: AppRole; department_id: string | null };
interface UserRow {
  id: string; full_name: string; email: string | null; phone: string | null; photo_url: string | null;
  is_active: boolean; last_sign_in_at: string | null; roles: RoleRow[];
}
type TableRow = UserRow & { roleText: string; roleKey: string; deptText: string; statusKey: string; lastLogin: string };

const USERS_KEY = ["users"] as const;

function genPassword() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (n) => c[n % c.length]).join("") + "7a";
}
const validPw = (p: string) => p.length >= 8 && /[a-z]/i.test(p) && /\d/.test(p);

function UsersPage() {
  const { t, i18n } = useTranslation();
  const { context, hasRole } = useMyContext();
  const isSuper = hasRole("super_admin");
  const grantable = isSuper ? ALL_ROLES : BELOW_ADMIN;

  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => callEdgeFunction<UserRow[]>("list-users"),
  });
  const depts = useQuery({
    queryKey: ["departments", context?.hospital?.id],
    enabled: !!context?.hospital?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const deptName = (id: string | null) => depts.data?.find((d) => d.id === id)?.name ?? "";

  const canManage = (u: UserRow) =>
    isSuper || (u.id !== context?.profile?.id && u.roles.every((r) => BELOW_ADMIN.includes(r.role)));

  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [toggleFor, setToggleFor] = useState<UserRow | null>(null);
  const [actAs, setActAs] = useState<UserRow | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const startImp = useEdgeFunction<{ session_id: string; expires_at: string }, { target_user_id: string; reason: string }>("start-impersonation");
  const canActAs = (u: UserRow) =>
    isSuper && !context?.impersonation && u.is_active && u.id !== context?.profile?.id && !u.roles.some((r) => r.role === "super_admin");

  const deactivate = useEdgeFunction("deactivate-user", { invalidate: [USERS_KEY], successMessage: t("users.deactivated") });
  const reactivate = useEdgeFunction("reactivate-user", { invalidate: [USERS_KEY], successMessage: t("users.reactivated") });

  const fmt = useMemo(() => new Intl.DateTimeFormat(i18n.language === "ur" ? "ur-PK" : "en-PK", { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);

  const rows: TableRow[] = (users.data ?? []).map((u) => ({
    ...u,
    roleText: u.roles.map((r) => t(`roles.${r.role}`)).join(", "),
    roleKey: u.roles.map((r) => r.role).join(" "),
    deptText: [...new Set(u.roles.map((r) => deptName(r.department_id)).filter(Boolean))].join(", "),
    statusKey: u.is_active ? "active" : "inactive",
    lastLogin: u.last_sign_in_at ?? "",
  }));

  const columns: Column<TableRow>[] = [
    {
      key: "full_name", header: t("users.name"), sortable: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          {u.photo_url ? (
            <img src={u.photo_url} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
              {u.full_name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="font-medium">
              {u.full_name}
              {u.id === context?.profile?.id && <span className="ms-2 text-xs text-muted-foreground">({t("users.you")})</span>}
            </div>
            {u.email && <Ltr className="block truncate text-xs text-muted-foreground">{u.email}</Ltr>}
          </div>
        </div>
      ),
    },
    { key: "roleText", header: t("users.roles"), render: (u) => u.roleText || "—" },
    { key: "deptText", header: t("users.department"), render: (u) => u.deptText || "—" },
    {
      key: "statusKey", header: t("users.status"), sortable: true,
      render: (u) => <StatusChip status={u.is_active ? "ok" : "inactive"}>{t(u.is_active ? "users.active" : "users.inactive")}</StatusChip>,
    },
    {
      key: "lastLogin", header: t("users.lastLogin"), sortable: true,
      render: (u) => (u.last_sign_in_at ? <Ltr>{fmt.format(new Date(u.last_sign_in_at))}</Ltr> : <span className="text-muted-foreground">{t("users.never")}</span>),
    },
    {
      key: "id", header: t("users.actions"),
      render: (u) =>
        canManage(u) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("users.actions")}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(u)}>{t("users.editDetails")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRolesFor(u)}>{t("users.editRoles")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setResetFor(u)}>{t("users.resetPassword")}</DropdownMenuItem>
              {canActAs(u) && <DropdownMenuItem onSelect={() => setActAs(u)}>{t("impersonation.action")}</DropdownMenuItem>}
              {u.id !== context?.profile?.id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={u.is_active ? "text-urgent-fg" : undefined}
                    onSelect={() => setToggleFor(u)}
                  >
                    {t(u.is_active ? "users.deactivate" : "users.reactivate")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("users.title")}</h1>
        <Button onClick={() => setEditing("new")}><UserPlus /> {t("users.add")}</Button>
      </div>
      {!isSuper && <Banner tone="info" title={t("users.adminLimit")} />}
      {users.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : users.isError ? (
        <Banner tone="danger" title={t("users.loadError")}>
          {(users.error as { message?: string })?.message}
        </Banner>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          searchKeys={["full_name", "email", "phone"]}
          pageSize={10}
          filters={[{ key: "roleKey", label: t("users.roles"), options: ALL_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) })) }]}
        />
      )}

      <UserForm
        key={editing === "new" ? "new" : editing?.id ?? "none"}
        target={editing}
        onClose={() => setEditing(null)}
        grantable={grantable}
        depts={depts.data ?? []}
      />
      {rolesFor && (
        <RolesPanel user={rolesFor} grantable={grantable} depts={depts.data ?? []} onClose={() => setRolesFor(null)} />
      )}
      {resetFor && <ResetPanel user={resetFor} onClose={() => setResetFor(null)} />}
      <ConfirmDialog
        open={!!actAs}
        onOpenChange={(o) => !o && setActAs(null)}
        title={t("impersonation.title", { name: actAs?.full_name })}
        description={t("impersonation.body")}
        confirmLabel={t("impersonation.start")}
        danger
        onConfirm={(reason) => {
          const u = actAs;
          setActAs(null);
          if (!u) return;
          startImp.mutate(
            { target_user_id: u.id, reason },
            {
              onSuccess: async (res) => {
                setImpersonation({
                  sessionId: res.session_id,
                  expiresAt: res.expires_at,
                  targetName: u.full_name,
                  targetRole: u.roles[0]?.role ?? "patient",
                });
                await qc.invalidateQueries();
                toast(t("impersonation.started", { name: u.full_name }));
                navigate({ to: "/dashboard" });
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={!!toggleFor}
        onOpenChange={(o) => !o && setToggleFor(null)}
        title={t(toggleFor?.is_active ? "users.deactivateTitle" : "users.reactivateTitle", { name: toggleFor?.full_name })}
        {...(toggleFor?.is_active ? { description: t("users.deactivateBody") } : {})}
        confirmLabel={t(toggleFor?.is_active ? "users.deactivate" : "users.reactivate")}
        danger={!!toggleFor?.is_active}
        onConfirm={(reason) => {
          if (!toggleFor) return;
          (toggleFor.is_active ? deactivate : reactivate).mutate({ user_id: toggleFor.id, reason });
          setToggleFor(null);
        }}
      />
    </div>
  );
}

function RolePicker({
  value, onChange, grantable, depts,
}: { value: RoleRow[]; onChange: (v: RoleRow[]) => void; grantable: AppRole[]; depts: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const has = (r: AppRole) => value.find((x) => x.role === r);
  return (
    <div className="space-y-2">
      {grantable.map((r) => {
        const row = has(r);
        return (
          <div key={r} className="flex flex-wrap items-center gap-3 rounded-staff border p-2">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <Checkbox
                checked={!!row}
                onCheckedChange={(c) => onChange(c ? [...value, { role: r, department_id: null }] : value.filter((x) => x.role !== r))}
              />
              {t(`roles.${r}`)}
            </label>
            {row && (
              <Select
                value={row.department_id ?? "none"}
                onValueChange={(d) => onChange(value.map((x) => (x.role === r ? { ...x, department_id: d === "none" ? null : d } : x)))}
              >
                <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("users.noDepartment")}</SelectItem>
                  {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function rolesError(roles: RoleRow[], t: (k: string) => string) {
  if (roles.length === 0) return t("users.pickRole");
  if (roles.some((r) => NEEDS_DEPT.includes(r.role) && !r.department_id)) return t("users.needsDept");
  return null;
}

function UserForm({
  target, onClose, grantable, depts,
}: { target: UserRow | "new" | null; onClose: () => void; grantable: AppRole[]; depts: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const isNew = target === "new";
  const u = target && target !== "new" ? target : null;
  const [name, setName] = useState(u?.full_name ?? "");
  const [email, setEmail] = useState(u?.email ?? "");
  const [phone, setPhone] = useState(u?.phone ?? "");
  const [photo, setPhoto] = useState(u?.photo_url ?? "");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const create = useEdgeFunction("create-user", { invalidate: [USERS_KEY], successMessage: t("users.created") });
  const update = useEdgeFunction("update-user", { invalidate: [USERS_KEY], successMessage: t("users.updated") });
  const busy = create.isPending || update.isPending;

  const submit = () => {
    if (!name.trim() || !email.trim() || (isNew && !validPw(password))) { toast.error(t("users.required")); return; }
    const common = { full_name: name.trim(), email: email.trim(), phone: phone || null, photo_url: photo || null };
    if (isNew) {
      const err = rolesError(roles, t);
      if (err) { toast.error(err); return; }
      create.mutate({ ...common, temporary_password: password, roles }, { onSuccess: onClose });
    } else if (u) {
      update.mutate({ user_id: u.id, ...common }, { onSuccess: onClose });
    }
  };

  return (
    <SidePanel
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={t(isNew ? "users.add" : "users.edit")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("users.cancel")}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? t("users.saving") : t("users.save")}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("users.name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("users.email")}><Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t("users.phone")}><PhoneInput dir="ltr" value={phone} onValueChange={setPhone} /></Field>
        <Field label={t("users.photo")}><Input dir="ltr" value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="https://" /></Field>
        {isNew && (
          <>
            <Field label={t("users.tempPassword")}>
              <div className="flex gap-2">
                <Input dir="ltr" className="ltr-code" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button type="button" variant="secondary" onClick={() => setPassword(genPassword())}>{t("users.generate")}</Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("users.tempPasswordHint")}</p>
            </Field>
            <Field label={t("users.roles")}>
              <RolePicker value={roles} onChange={setRoles} grantable={grantable} depts={depts} />
            </Field>
          </>
        )}
      </div>
    </SidePanel>
  );
}

function RolesPanel({
  user, grantable, depts, onClose,
}: { user: UserRow; grantable: AppRole[]; depts: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleRow[]>(user.roles);
  const save = useEdgeFunction("set-user-roles", { invalidate: [USERS_KEY], successMessage: t("users.rolesSaved") });
  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("users.rolesTitle", { name: user.full_name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("users.cancel")}</Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              const err = rolesError(roles, t);
              if (err) { toast.error(err); return; }
              save.mutate({ user_id: user.id, roles }, { onSuccess: onClose });
            }}
          >
            {save.isPending ? t("users.saving") : t("users.save")}
          </Button>
        </div>
      }
    >
      <RolePicker value={roles} onChange={setRoles} grantable={grantable} depts={depts} />
    </SidePanel>
  );
}

function ResetPanel({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState(genPassword());
  const reset = useEdgeFunction("reset-user-password", { successMessage: t("users.resetDone") });
  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("users.resetTitle", { name: user.full_name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("users.cancel")}</Button>
          <Button
            disabled={reset.isPending || !validPw(password)}
            onClick={() => reset.mutate({ user_id: user.id, temporary_password: password }, { onSuccess: onClose })}
          >
            {t("users.resetPassword")}
          </Button>
        </div>
      }
    >
      <Field label={t("users.tempPassword")}>
        <div className="flex gap-2">
          <Input dir="ltr" className="ltr-code" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="button" variant="secondary" onClick={() => setPassword(genPassword())}>{t("users.generate")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("users.tempPasswordHint")}</p>
      </Field>
    </SidePanel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
