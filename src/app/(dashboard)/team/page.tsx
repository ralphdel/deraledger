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
  view_invoices: "View Invoices",
  create_invoice: "Create Invoices",
  edit_invoice: "Edit Invoices",
  record_payment: "Record Payments",
  manual_close: "Manually Close Invoices",
  void_invoice: "Void Invoices",
  view_clients: "View Clients",
  manage_clients: "Manage Clients",
  delete_client: "Delete Clients",
  view_analytics: "View Analytics",
  view_transactions: "View Transactions",
  manage_kyc: "Manage KYC",
  change_fee_settings: "Change Fee Settings",
  manage_business: "Manage Business Info",
  manage_billing: "Manage Billing",
  manage_team: "Manage Team",
  use_purpbot: "Use PurpBot AI",
  view_settlements: "View Settlements & Reports",
  manage_advance_settings: "Manage Advance Settings",
  manage_settlement_account: "Manage Settlement Account",
  manage_item_catalog: "Manage Item Catalog",
  manage_discount_template: "Manage Discount Templates",
  view_item_catalog: "View Item Catalog",
  view_discount_template: "View Discount Templates",
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
      // Sort roles to put owner first, then system roles, then custom roles
      const sorted = [...data].sort((a, b) => {
        if (a.name === "owner") return -1;
        if (b.name === "owner") return 1;
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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Team Management</h1>
          <p className="text-neutral-500 text-sm mt-1">Manage workspace members, roles, and access control.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Sheet>
            <SheetTrigger render={<Button className="bg-purp-700 hover:bg-purp-800 text-white font-semibold" />}>
              <Plus className="h-4 w-4 mr-2" /> Invite Member
            </SheetTrigger>
            <SheetContent className="border-l-2 border-purp-200 w-full sm:max-w-md p-0 flex flex-col">
              <div className="p-6 border-b border-purp-100 bg-purp-50/50">
                <SheetHeader>
                  <SheetTitle className="text-xl font-bold text-purp-900">Invite Team Member</SheetTitle>
                  <SheetDescription>Send an email invitation to collaborate in {businessName}.</SheetDescription>
                </SheetHeader>
              </div>
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                {inviteError && (
                  <div className="bg-red-50 text-red-700 border-2 border-red-200 p-3 rounded-lg text-sm flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{inviteError}</p>
                  </div>
                )}
                {inviteSuccess && (
                  <div className="bg-emerald-50 text-emerald-700 border-2 border-emerald-200 p-3 rounded-lg text-sm flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{inviteSuccess}</p>
                  </div>
                )}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-purp-900 font-semibold">Email Address</Label>
                    <Input 
                      placeholder="colleague@company.com" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)} 
                      className="border-2 border-purp-200 focus:border-purp-500" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-purp-900 font-semibold">Assign Role</Label>
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200">
                        <SelectValue placeholder="Select a role..." />
                      </SelectTrigger>
                      <SelectContent className="border-2 border-purp-200">
                        {roles.map(r => (
                          <SelectItem key={r.id} value={r.name} disabled={r.name === "owner"}>
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
              <div className="p-6 border-t border-purp-100 bg-neutral-50 mt-auto">
                <Button 
                  onClick={handleInvite} 
                  disabled={sendingInvite || !inviteEmail || !inviteRole} 
                  className="w-full bg-purp-700 hover:bg-purp-800"
                >
                  {sendingInvite ? "Sending..." : "Send Invitation"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="bg-neutral-100/80 p-1.5 border-2 border-neutral-200 mb-6 inline-flex w-full md:w-auto h-auto rounded-xl gap-2">
          <TabsTrigger 
            value="members" 
            className="data-[state=active]:bg-purp-700 data-[state=active]:text-white data-[state=active]:shadow-md font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all text-neutral-600 hover:text-purp-700 hover:bg-purp-50"
          >
            <Users className="w-4 h-4" /> Members & Invites
          </TabsTrigger>
          <TabsTrigger 
            value="roles" 
            className="data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all text-neutral-600 hover:text-amber-700 hover:bg-amber-50"
          >
            <ShieldCheck className="w-4 h-4" /> Roles & Permissions Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4 outline-none">
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="bg-purp-50/50 border-b-2 border-purp-100 pb-4">
              <CardTitle className="text-lg text-purp-900">Active Team</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-purp-100">
                    <TableHead className="font-bold text-purp-900">Member</TableHead>
                    <TableHead className="font-bold text-purp-900">Role</TableHead>
                    <TableHead className="font-bold text-purp-900">Status</TableHead>
                    <TableHead className="font-bold text-purp-900">Joined</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-neutral-500">No members found.</TableCell>
                    </TableRow>
                  ) : team.map(member => {
                    const RoleIcon = getRoleConfig(member.role).icon;
                    return (
                      <TableRow key={member.id} className="border-purp-100 hover:bg-purp-50/30">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${getRoleConfig(member.role).color}`}>
                              <RoleIcon className="w-4 h-4" />
                            </div>
                            <div className="font-medium text-neutral-900">{member.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-bold border-2 ${getRoleConfig(member.role).color}`}>
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.status === "invited" ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 border-2">Pending</Badge>
                          ) : member.is_active === false ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 border-2">Deactivated</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 border-2">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-500 text-sm">
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {member.role !== "owner" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="hover:bg-purp-100 text-purp-600" />}>
                                <MoreHorizontal className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200">
                                {member.status === "active" || member.is_active ? (
                                  <DropdownMenuItem onClick={() => deactivateTeamMemberAction(member.id, merchant?.id || "")} className="text-amber-700 font-medium cursor-pointer">
                                    <Ban className="h-4 w-4 mr-2" /> Deactivate Access
                                  </DropdownMenuItem>
                                ) : member.is_active === false ? (
                                  <DropdownMenuItem onClick={() => reactivateTeamMemberAction(member.id, merchant?.id || "")} className="text-emerald-700 font-medium cursor-pointer">
                                    <UserCheck className="h-4 w-4 mr-2" /> Reactivate Access
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuSeparator className="bg-purp-100" />
                                <DropdownMenuItem onClick={() => setMemberToRemove(member)} className="text-red-600 font-medium cursor-pointer focus:bg-red-50">
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
          <Card className="border-2 border-amber-200 shadow-none overflow-hidden">
            <CardHeader className="bg-amber-50/50 border-b-2 border-amber-100 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg text-amber-900">Permission Matrix</CardTitle>
                <CardDescription>Overview of what each role can access.</CardDescription>
              </div>
              <Sheet>
                <SheetTrigger render={<Button variant="outline" className="border-2 border-amber-200 text-amber-700 hover:bg-amber-100 shadow-sm" />}>
                  <Settings2 className="h-4 w-4 mr-2" /> Build Custom Role
                </SheetTrigger>
                <SheetContent className="border-l-2 border-purp-200 w-full sm:max-w-md p-0 flex flex-col">
                  <div className="p-6 border-b border-purp-100 bg-purp-50/50">
                    <SheetHeader>
                      <SheetTitle className="text-xl font-bold text-purp-900">Build Custom Role</SheetTitle>
                      <SheetDescription>Create a role with granular permissions tailored to your needs.</SheetDescription>
                    </SheetHeader>
                  </div>
                  <div className="p-6 flex-1 overflow-y-auto space-y-6">
                    {roleMessage && (
                      <div className={`p-3 rounded-lg text-sm border-2 ${roleMessage.type === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                        {roleMessage.text}
                      </div>
                    )}
                    <div className="space-y-3">
                      <Label className="text-purp-900 font-semibold">Role Name</Label>
                      <Input 
                        placeholder="e.g. Junior Auditor" 
                        value={newRoleName} 
                        onChange={(e) => setNewRoleName(e.target.value)}
                        className="border-2 border-purp-200"
                      />
                    </div>
                    <div className="space-y-4">
                      <Label className="text-purp-900 font-semibold mb-2 block">Toggle Permissions</Label>
                      {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between p-3 border-2 border-neutral-100 rounded-lg hover:border-purp-100 hover:bg-purp-50/30 transition-colors">
                          <Label htmlFor={`perm-${key}`} className="cursor-pointer text-sm font-medium text-neutral-700">
                            {label}
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
                  <div className="p-6 border-t border-purp-100 bg-neutral-50 mt-auto">
                    <Button 
                      onClick={handleCreateCustomRole} 
                      disabled={creatingRole || !newRoleName} 
                      className="w-full bg-purp-700 hover:bg-purp-800"
                    >
                      {creatingRole ? "Saving..." : "Save Custom Role"}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-neutral-50/50">
                    <TableHead className="font-bold text-purp-900 min-w-[200px]">Permission</TableHead>
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
                  {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                    <TableRow key={key} className="hover:bg-purp-50/30">
                      <TableCell className="font-medium text-neutral-700 text-sm">{label}</TableCell>
                      {roles.map(r => {
                        const hasPerm = r.permissions?.[key];
                        return (
                          <TableCell key={r.id} className="text-center">
                            {hasPerm ? (
                              <CheckCircle className="h-4 w-4 text-emerald-500 mx-auto" />
                            ) : (
                              <span className="text-neutral-300 font-bold">—</span>
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
        <DialogContent className="border-2 border-red-200 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Confirm Removal
            </DialogTitle>
            <DialogDescription className="text-neutral-600 pt-2">
              Are you sure you want to permanently remove <span className="font-semibold text-neutral-900">{memberToRemove?.email}</span>?
              They will instantly lose all access to this workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMemberToRemove(null)} className="border-2 hover:bg-neutral-50">Cancel</Button>
            <Button variant="destructive" onClick={confirmRemoveMember} disabled={isRemoving} className="bg-red-600 hover:bg-red-700">
              {isRemoving ? "Removing..." : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
