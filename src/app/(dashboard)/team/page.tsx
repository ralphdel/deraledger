"use client";

import { useEffect, useState } from "react";
import {
  Users, Plus, Mail, Shield, Crown, Calculator, Clock,
  Trash2, Copy, CheckCircle, Headset, Settings2, ShieldCheck, 
  ChevronRight, Activity
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { getMerchant } from "@/lib/data";
import { 
  createCustomRoleAction, sendInviteAction, fetchTeamMembersAction,
  deactivateTeamMemberAction, reactivateTeamMemberAction, removeTeamMemberAction
} from "@/lib/actions";
import type { Role, Merchant } from "@/lib/types";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Ban, UserMinus, UserCheck, AlertTriangle } from "lucide-react";

interface TeamMember {
  id: string;
  user_id?: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "invited";
  joinedAt: string;
  is_active?: boolean;
}

const PERMISSION_LABELS: Record<string, string> = {
  // ── Invoices ──────────────────────────────────────────
  view_invoices: "View Invoices",
  create_invoice: "Create Invoices",
  edit_invoice: "Edit Invoices",
  record_payment: "Record Payments",
  manual_close: "Manually Close Invoices",
  void_invoice: "Void Invoices",
  // ── References ────────────────────────────────────────
  view_references: "View References",
  manage_references: "Manage References (Create / Edit)",
  // ── Clients ───────────────────────────────────────────
  view_clients: "View Clients",
  manage_clients: "Manage Clients (Add / Edit)",
  delete_client: "Delete Clients",
  // ── Analytics & Financial ─────────────────────────────
  view_analytics: "View Analytics & Reports",
  view_transactions: "View Transactions",
  view_settlements: "View Settlements",
  // ── Catalog & Templates ───────────────────────────────
  view_item_catalog: "View Item Catalog",
  manage_item_catalog: "Manage Item Catalog",
  view_discount_template: "View Discount Templates",
  manage_discount_template: "Manage Discount Templates",
  // ── Settings & Admin ──────────────────────────────────
  manage_kyc: "Manage KYC / Verification",
  manage_business: "Manage Business Info & Address",
  change_fee_settings: "Change Fee Settings",
  manage_billing: "Manage Billing & Subscription",
  manage_team: "Manage Team Members & Roles",
  manage_advance_settings: "Manage Advanced Settings",
  manage_settlement_account: "Manage Settlement Account",
  // ── AI ────────────────────────────────────────────────
  use_purpbot: "Use DeraBot AI",
};

/**
 * Canonical predefined role permission sets.
 * These MUST match what is seeded in the `roles` table in the database.
 * Used to show correct permissions for each predefined role in the matrix
 * and to validate that team-member role DB rows have correct permissions.
 */
const PREDEFINED_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  owner: Object.fromEntries(Object.keys(PERMISSION_LABELS).map(k => [k, true])),
  admin: {
    view_invoices: true, create_invoice: true, edit_invoice: true,
    record_payment: true, manual_close: true, void_invoice: false,
    view_references: true, manage_references: true,
    view_clients: true, manage_clients: true, delete_client: false,
    view_analytics: true, view_transactions: true, view_settlements: true,
    view_item_catalog: true, manage_item_catalog: true,
    view_discount_template: true, manage_discount_template: true,
    manage_kyc: false, manage_business: true, change_fee_settings: true,
    manage_billing: false, manage_team: true,
    manage_advance_settings: true, manage_settlement_account: false,
    use_purpbot: true,
  },
  accountant: {
    view_invoices: true, create_invoice: true, edit_invoice: true,
    record_payment: true, manual_close: true, void_invoice: false,
    view_references: true, manage_references: false,
    view_clients: true, manage_clients: false, delete_client: false,
    view_analytics: true, view_transactions: true, view_settlements: true,
    view_item_catalog: true, manage_item_catalog: false,
    view_discount_template: true, manage_discount_template: false,
    manage_kyc: false, manage_business: false, change_fee_settings: false,
    manage_billing: false, manage_team: false,
    manage_advance_settings: false, manage_settlement_account: false,
    use_purpbot: true,
  },
  support: {
    view_invoices: true, create_invoice: false, edit_invoice: false,
    record_payment: false, manual_close: false, void_invoice: false,
    view_references: true, manage_references: false,
    view_clients: true, manage_clients: true, delete_client: false,
    view_analytics: false, view_transactions: false, view_settlements: false,
    view_item_catalog: true, manage_item_catalog: false,
    view_discount_template: false, manage_discount_template: false,
    manage_kyc: false, manage_business: false, change_fee_settings: false,
    manage_billing: false, manage_team: false,
    manage_advance_settings: false, manage_settlement_account: false,
    use_purpbot: false,
  },
};

export default function TeamPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [workspaceCode, setWorkspaceCode] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  
  const [memberToRemove, setMemberToRemove] = useState<{id: string, email: string} | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);

  // Custom role state
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleMessage, setRoleMessage] = useState<{type: "success" | "error", text: string} | null>(null);
  const [newRolePerms, setNewRolePerms] = useState<Record<string, boolean>>(
    Object.keys(PERMISSION_LABELS).reduce((acc, key) => ({ ...acc, [key]: false }), {})
  );

  const fetchRoles = async (mId: string) => {
    const sb = createClient();
    const { data } = await sb.from("roles")
      .select("*")
      .or(`is_system_role.eq.true,merchant_id.eq.${mId}`)
      .order("name");
    if (data) {
      // Exclude "owner" — it's not a valid assignable role for team members
      const filtered = data.filter((r: any) => r.name !== "owner");
      const sorted = [...filtered].sort((a, b) => {
        if (a.is_system_role && !b.is_system_role) return -1;
        if (!a.is_system_role && b.is_system_role) return 1;
        return a.name.localeCompare(b.name);
      });
      setRoles(sorted as Role[]);
    }
  };

  const loadTeam = async (mId: string, ownerEmail: string, ownerCreatedAt: string) => {
    const { success, team: fetchedTeam } = await fetchTeamMembersAction(mId);
    if (success && fetchedTeam) {
      const ownerExists = fetchedTeam.some((t: any) => t.email === ownerEmail);
      let allMembers = [...fetchedTeam];
      if (!ownerExists) {
        allMembers.unshift({ 
          id: mId, user_id: mId, email: ownerEmail, role: "owner", 
          status: "active", joinedAt: ownerCreatedAt, is_active: true
        });
      }
      setTeam(allMembers);
    }
  };

  useEffect(() => {
    getMerchant().then((m) => {
      if (m) {
        setMerchant(m);
        setBusinessName(m.business_name);
        if (m.workspace_code) setWorkspaceCode(m.workspace_code);
        Promise.all([
          fetchRoles(m.id),
          loadTeam(m.id, m.email, m.created_at || "2025-01-01")
        ]).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  const getRoleConfig = (roleName: string) => {
    switch(roleName.toLowerCase()) {
      case "owner": return { icon: Crown, color: "bg-purple-100 text-purple-700 border-purple-200" };
      case "admin": return { icon: ShieldCheck, color: "bg-amber-100 text-amber-700 border-amber-200" };
      case "accountant": return { icon: Calculator, color: "bg-blue-100 text-blue-700 border-blue-200" };
      case "support": return { icon: Headset, color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
      default: return { icon: Settings2, color: "bg-neutral-100 text-neutral-700 border-neutral-200" };
    }
  };

  const handleInvite = async () => {
    setInviteError(null); setInviteSuccess(null);
    if (!inviteEmail || !inviteRole || !workspaceCode) {
      setInviteError("Missing required fields or Workspace Code not configured.");
      return;
    }
    setSendingInvite(true);
    const { success, error } = await sendInviteAction(inviteEmail, inviteRole, workspaceCode, businessName, merchant?.id || "");
    if (success) {
      setInviteSuccess(`Success! Invite email sent to ${inviteEmail}`);
      setInviteEmail(""); setInviteRole("");
      if (merchant) await loadTeam(merchant.id, merchant.email, merchant.created_at || "2025-01-01");
    } else {
      setInviteError(error || "Failed to send invite");
    }
    setSendingInvite(false);
  };

  const confirmRemoveMember = async () => {
    if (!memberToRemove) return;
    setIsRemoving(true);
    await removeTeamMemberAction(memberToRemove.id, merchant?.id || "");
    if (merchant) await loadTeam(merchant.id, merchant.email, merchant.created_at || "2025-01-01");
    setIsRemoving(false); setMemberToRemove(null);
  };

  const handleCreateCustomRole = async () => {
    if (!newRoleName.trim() || !merchant?.id) return;
    setCreatingRole(true); setRoleMessage(null);
    const { success, error } = await createCustomRoleAction(merchant.id, newRoleName, newRolePerms);
    if (success) {
      setRoleMessage({ type: "success", text: "Role created successfully." });
      setNewRoleName("");
      setNewRolePerms(Object.keys(PERMISSION_LABELS).reduce((acc, key) => ({ ...acc, [key]: false }), {}));
      await fetchRoles(merchant.id);
    } else {
      setRoleMessage({ type: "error", text: error || "Failed to create role." });
    }
    setCreatingRole(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-neutral-500 animate-pulse">Loading workspace details...</div>;
  }

  // ── Plan-aware permission intersection ──────────────────────────────────────
  // Permissions that are meaningful for a team member on this plan.
  // Even if a role grants a permission, the plan may not support that feature.
  const currentPlan = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  // Permissions unavailable on Starter (no collections, no analytics, no references)
  const STARTER_BLOCKED = new Set([
    "view_settlements", "manage_settlement_account",
    "view_analytics",
    "view_references", "manage_references",
    "view_transactions",
    "change_fee_settings",
    "void_invoice",
  ]);
  // Permissions unavailable on Individual (no advanced analytics)
  const INDIVIDUAL_BLOCKED = new Set(["view_analytics"]);

  const blockedPerms =
    currentPlan === "starter" ? STARTER_BLOCKED
    : currentPlan === "individual" ? INDIVIDUAL_BLOCKED
    : new Set<string>(); // corporate: nothing blocked

  // Filter PERMISSION_LABELS to remove plan-blocked keys
  const visiblePermissionLabels = Object.entries(PERMISSION_LABELS).filter(
    ([key]) => !blockedPerms.has(key)
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900 dark:text-white">Team Management</h1>
          <p className="text-neutral-500 dark:text-white/60 text-sm mt-1">Manage workspace members, roles, and access control.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Sheet>
            <SheetTrigger render={<Button className="bg-purp-700 hover:bg-purp-800 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 text-white font-semibold" />}>
              <Plus className="h-4 w-4 mr-2" /> Invite Member
            </SheetTrigger>
            <SheetContent className="border-l-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] w-full sm:max-w-md p-0 flex flex-col">
              <div className="p-6 border-b border-purp-100 dark:border-white/10 bg-purp-50/50 dark:bg-white/5">
                <SheetHeader>
                  <SheetTitle className="text-xl font-bold text-purp-900 dark:text-white">Invite Team Member</SheetTitle>
                  <SheetDescription className="dark:text-white/60">Send an email invitation to collaborate in {businessName}.</SheetDescription>
                </SheetHeader>
              </div>
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                {inviteError && (
                  <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-2 border-red-200 dark:border-red-500/20 p-3 rounded-lg text-sm flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{inviteError}</p>
                  </div>
                )}
                {inviteSuccess && (
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-2 border-emerald-200 dark:border-emerald-500/20 p-3 rounded-lg text-sm flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{inviteSuccess}</p>
                  </div>
                )}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-purp-900 dark:text-white font-semibold">Email Address</Label>
                    <Input 
                      placeholder="colleague@company.com" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)} 
                      className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] dark:text-white focus:border-purp-500" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-purp-900 dark:text-white font-semibold">Assign Role</Label>
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] dark:text-white">
                        <SelectValue placeholder="Select a role..." />
                      </SelectTrigger>
                      <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                        {roles.map(r => (
                          <SelectItem key={r.id} value={r.name} disabled={r.name === "owner"} className="dark:text-white dark:focus:bg-white/5">
                            <div className="flex items-center gap-2 capitalize">
                              <span className={`w-2 h-2 rounded-full ${getRoleConfig(r.name).color.split(" ")[0]}`} />
                              {r.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-purp-100 dark:border-white/10 bg-neutral-50 dark:bg-white/5 mt-auto">
                <Button 
                  onClick={handleInvite} 
                  disabled={sendingInvite || !inviteEmail || !inviteRole} 
                  className="w-full bg-purp-700 hover:bg-purp-800 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 dark:text-white"
                >
                  {sendingInvite ? "Sending..." : "Send Invitation"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="bg-neutral-100/80 dark:bg-white/5 p-1.5 border-2 border-neutral-200 dark:border-white/10 mb-6 inline-flex w-full md:w-auto h-auto rounded-xl gap-2">
          <TabsTrigger 
            value="members" 
            className="data-[state=active]:bg-purp-700 data-[state=active]:text-white dark:data-[state=active]:bg-[#7B2FF7] data-[state=active]:shadow-md font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all text-neutral-600 dark:text-white/60 hover:text-purp-700 dark:hover:text-white hover:bg-purp-50 dark:hover:bg-white/5"
          >
            <Users className="w-4 h-4" /> Members & Invites
          </TabsTrigger>
          <TabsTrigger 
            value="roles" 
            className="data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all text-neutral-600 dark:text-white/60 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
          >
            <ShieldCheck className="w-4 h-4" /> Roles & Permissions Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4 outline-none">
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="bg-purp-50/50 dark:bg-white/5 border-b-2 border-purp-100 dark:border-white/10 pb-4">
              <CardTitle className="text-lg text-purp-900 dark:text-white">Active Team</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-purp-100 dark:border-white/10">
                    <TableHead className="font-bold text-purp-900 dark:text-white">Member</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white">Role</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white">Status</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white">Joined</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-neutral-500 dark:text-white/50">No members found.</TableCell>
                    </TableRow>
                  ) : team.map(member => {
                    const RoleIcon = getRoleConfig(member.role).icon;
                    return (
                      <TableRow key={member.id} className="border-purp-100 dark:border-white/10 hover:bg-purp-50/30 dark:hover:bg-white/5">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${getRoleConfig(member.role).color}`}>
                              <RoleIcon className="w-4 h-4" />
                            </div>
                            <div className="font-medium text-neutral-900 dark:text-white">{member.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-bold border-2 ${getRoleConfig(member.role).color}`}>
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.status === "invited" ? (
                            <Badge variant="outline" className="bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 border-2">Pending</Badge>
                          ) : member.is_active === false ? (
                            <Badge variant="outline" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20 border-2">Deactivated</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 border-2">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-500 dark:text-white/60 text-sm">
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {member.role !== "owner" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="hover:bg-purp-100 dark:hover:bg-white/10 text-purp-600 dark:text-white/80" />}>
                                <MoreHorizontal className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                                {member.status === "active" || member.is_active ? (
                                  <DropdownMenuItem onClick={() => deactivateTeamMemberAction(member.id, merchant?.id || "")} className="text-amber-700 dark:text-amber-400 font-medium cursor-pointer dark:focus:bg-white/5">
                                    <Ban className="h-4 w-4 mr-2" /> Deactivate Access
                                  </DropdownMenuItem>
                                ) : member.is_active === false ? (
                                  <DropdownMenuItem onClick={() => reactivateTeamMemberAction(member.id, merchant?.id || "")} className="text-emerald-700 dark:text-emerald-400 font-medium cursor-pointer dark:focus:bg-white/5">
                                    <UserCheck className="h-4 w-4 mr-2" /> Reactivate Access
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuSeparator className="bg-purp-100 dark:bg-white/10" />
                                <DropdownMenuItem onClick={() => setMemberToRemove(member)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer focus:bg-red-50 dark:focus:bg-red-500/10">
                                  <Trash2 className="h-4 w-4 mr-2" /> Remove Member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-6 outline-none">
          <Card className="border-2 border-amber-200 dark:border-amber-500/20 shadow-none overflow-hidden dark:bg-[#1A0B2E]">
            <CardHeader className="bg-amber-50/50 dark:bg-amber-500/5 border-b-2 border-amber-100 dark:border-amber-500/10 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg text-amber-900 dark:text-amber-400">Permission Matrix</CardTitle>
                <CardDescription className="dark:text-white/60">Overview of what each role can access.</CardDescription>
              </div>
              {merchant?.subscription_plan === "corporate" || merchant?.merchant_tier === "corporate" ? (
                <Sheet>
                  <SheetTrigger render={<Button variant="outline" className="border-2 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/10 dark:bg-transparent shadow-sm" />}>
                    <Settings2 className="h-4 w-4 mr-2" /> Build Custom Role
                  </SheetTrigger>
                  <SheetContent className="border-l-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] w-full sm:max-w-md p-0 flex flex-col">
                    <div className="p-6 border-b border-purp-100 dark:border-white/10 bg-purp-50/50 dark:bg-white/5">
                      <SheetHeader>
                        <SheetTitle className="text-xl font-bold text-purp-900 dark:text-white">Build Custom Role</SheetTitle>
                        <SheetDescription className="dark:text-white/60">Create a role with granular permissions tailored to your needs.</SheetDescription>
                      </SheetHeader>
                    </div>
                    <div className="p-6 flex-1 overflow-y-auto space-y-6">
                      {roleMessage && (
                        <div className={`p-3 rounded-lg text-sm border-2 ${roleMessage.type === "success" ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20"}`}>
                          {roleMessage.text}
                        </div>
                      )}
                      <div className="space-y-3">
                        <Label className="text-purp-900 dark:text-white font-semibold">Role Name</Label>
                        <Input 
                          placeholder="e.g. Junior Auditor" 
                          value={newRoleName} 
                          onChange={(e) => setNewRoleName(e.target.value)}
                          className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] dark:text-white"
                        />
                      </div>
                      <div className="space-y-4">
                        <Label className="text-purp-900 dark:text-white font-semibold mb-2 block">Toggle Permissions</Label>
                  {visiblePermissionLabels.map(([key]) => (
                    <div key={key} className="flex items-center justify-between p-3 border-2 border-neutral-100 dark:border-white/10 rounded-lg hover:border-purp-100 dark:hover:border-white/20 hover:bg-purp-50/30 dark:hover:bg-white/5 transition-colors">
                      <Label htmlFor={`perm-${key}`} className="cursor-pointer text-sm font-medium text-neutral-700 dark:text-white/80">
                        {PERMISSION_LABELS[key]}
                      </Label>
                      <Switch 
                        id={`perm-${key}`}
                        checked={newRolePerms[key]} 
                        onCheckedChange={(c) => setNewRolePerms(prev => ({ ...prev, [key]: c }))}
                      />
                    </div>
                  ))}
                      </div>
                    </div>
                    <div className="p-6 border-t border-purp-100 dark:border-white/10 bg-neutral-50 dark:bg-white/5 mt-auto">
                      <Button 
                        onClick={handleCreateCustomRole} 
                        disabled={creatingRole || !newRoleName} 
                        className="w-full bg-purp-700 hover:bg-purp-800 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 dark:text-white"
                      >
                        {creatingRole ? "Saving..." : "Save Custom Role"}
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled
                    className="border-2 border-amber-200 dark:border-amber-500/20 text-amber-400 dark:text-amber-600 opacity-60 cursor-not-allowed shadow-sm dark:bg-transparent"
                    title="Custom roles require the Business plan"
                  >
                    <Settings2 className="h-4 w-4 mr-2" /> Build Custom Role
                  </Button>
                  <span className="text-xs text-amber-700 dark:text-amber-500 font-medium bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-1 rounded-md">
                    Business plan only
                  </span>
                </div>
              )}
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-neutral-50/50 dark:bg-white/5 border-b-2 border-amber-100 dark:border-amber-500/10">
                    <TableHead className="font-bold text-purp-900 dark:text-white min-w-[200px]">Permission</TableHead>
                    {roles.map(r => (
                      <TableHead key={r.id} className="text-center">
                        <Badge variant="outline" className={`capitalize mx-auto whitespace-nowrap border-2 ${getRoleConfig(r.name).color}`}>
                          {r.name}
                        </Badge>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePermissionLabels.map(([key, label]) => (
                    <TableRow key={key} className="hover:bg-purp-50/30 dark:hover:bg-white/5 dark:border-white/10">
                      <TableCell className="font-medium text-neutral-700 dark:text-white/80 text-sm">{label}</TableCell>
                      {roles.map(r => {
                        const hasPerm = r.permissions?.[key] && !blockedPerms.has(key);
                        return (
                          <TableCell key={r.id} className="text-center">
                            {hasPerm ? (
                              <CheckCircle className="h-4 w-4 text-emerald-500 dark:text-emerald-400 mx-auto" />
                            ) : (
                              <span className="text-neutral-300 dark:text-white/20 font-bold">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Remove Confirmation Dialog */}
      <Dialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <DialogContent className="border-2 border-red-200 dark:border-red-500/20 max-w-md dark:bg-[#1A0B2E]">
          <DialogHeader>
            <DialogTitle className="text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Confirm Removal
            </DialogTitle>
            <DialogDescription className="text-neutral-600 dark:text-white/60 pt-2">
              Are you sure you want to permanently remove <span className="font-semibold text-neutral-900 dark:text-white">{memberToRemove?.email}</span>?
              They will instantly lose all access to this workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMemberToRemove(null)} className="border-2 dark:border-white/10 dark:text-white dark:hover:bg-white/5 hover:bg-neutral-50">Cancel</Button>
            <Button variant="destructive" onClick={confirmRemoveMember} disabled={isRemoving} className="bg-red-600 hover:bg-red-700 border-2 border-red-600">
              {isRemoving ? "Removing..." : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
