"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Mail,
  Shield,
  Crown,
  Eye,
  Calculator,
  Clock,
  Trash2,
  Copy,
  CheckCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { getMerchant } from "@/lib/data";
import { createCustomRoleAction, sendInviteAction } from "@/lib/actions";
import type { Role, Merchant } from "@/lib/types";

interface TeamMember {
  id: string;
  email: string;
  role: string;
  status: "active" | "invited";
  joinedAt: string;
}

export default function TeamPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [copied, setCopied] = useState(false);
  const [merchantId, setMerchantId] = useState("");
  const [workspaceCode, setWorkspaceCode] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  const [team, setTeam] = useState<TeamMember[]>([]);

  // Custom role state
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRolePerms, setNewRolePerms] = useState<Record<string, boolean>>({
    use_purpbot: false,
    edit_invoice: false,
    view_invoices: false,
    create_invoice: false,
    manage_clients: false,
    view_analytics: false,
    view_transactions: false,
    manage_kyc: false,
    manage_team: false,
    manual_close: false,
    void_invoice: false,
    change_fee_settings: false,
  });

  const fetchRoles = async (mId: string) => {
    const sb = createClient();
    const { data } = await sb.from("roles")
      .select("*")
      .or(`is_system_role.eq.true,merchant_id.eq.${mId}`)
      .order("name");
    if (data) setRoles(data as Role[]);
  };

  useEffect(() => {
    getMerchant().then((merchant) => {
      if (merchant) {
        setMerchantId(merchant.id);
        setBusinessName(merchant.business_name);
        if (merchant.workspace_code) setWorkspaceCode(merchant.workspace_code);
        setTeam([
          { id: merchant.id, email: merchant.email, role: "owner", status: "active", joinedAt: merchant.created_at || "2025-01-01" },
        ]);
        fetchRoles(merchant.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  const roleIcons: Record<string, React.ElementType> = {
    owner: Crown,
    accountant: Calculator,
    viewer: Eye,
  };

  const roleColors: Record<string, string> = {
    owner: "bg-purple-100 text-purple-700 border-purple-200",
    accountant: "bg-blue-100 text-blue-700 border-blue-200",
    viewer: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteRole || !workspaceCode) {
      alert("Missing required fields or Workspace Code not configured.");
      return;
    }
    setSendingInvite(true);
    
    const { success, error } = await sendInviteAction(inviteEmail, inviteRole, workspaceCode, businessName);
    
    if (success) {
      alert(`Success! Invite email sent to ${inviteEmail} with Workspace Code: ${workspaceCode}.`);
      setInviteEmail("");
      setInviteRole("");
    } else {
      alert("Failed to send invite: " + error);
    }
    
    setSendingInvite(false);
  };

  const handleCreateCustomRole = async () => {
    if (!newRoleName.trim() || !merchantId) return;
    setCreatingRole(true);
    const { success, error } = await createCustomRoleAction(merchantId, newRoleName, newRolePerms);
    if (success) {
      await fetchRoles(merchantId);
      setNewRoleName("");
      // Reset permissions
      setNewRolePerms(Object.keys(newRolePerms).reduce((acc, key) => ({ ...acc, [key]: false }), {}));
      alert("Custom role created successfully!");
    } else {
      alert("Failed to create role: " + error);
    }
    setCreatingRole(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-purp-900">Team Management</h1>
        <Card className="border-2 border-purp-200 shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-32 bg-purp-50 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Team Management</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Manage team access and permissions (RBAC)
          </p>
          {workspaceCode && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Your Business ID:</span>
              <code className="text-sm bg-purp-50 text-purp-900 px-3 py-1 rounded border border-purp-200 font-mono font-bold tracking-widest">{workspaceCode}</code>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6" 
                onClick={() => {
                  navigator.clipboard.writeText(workspaceCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-neutral-500 hover:text-purp-700" />}
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger
              render={<Button variant="outline" className="border-2 border-purp-200 text-purp-900 font-semibold hover:bg-purp-50 bg-white" />}
            >
              <Shield className="mr-2 h-4 w-4" />
              Custom Role
            </DialogTrigger>
            <DialogContent className="border-2 border-purp-200 max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-purp-900">Create Custom Role</DialogTitle>
                <DialogDescription>
                  Define specific permissions for a custom role based on your company's needs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Role Name *</Label>
                  <Input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    className="border-2 border-purp-200 bg-purp-50 h-11"
                    placeholder="e.g. support_agent"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Permissions</Label>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {Object.keys(newRolePerms).map((key) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer p-2 border-2 border-purp-100 rounded-md hover:bg-purp-50">
                        <input 
                          type="checkbox" 
                          checked={newRolePerms[key]} 
                          onChange={(e) => setNewRolePerms({ ...newRolePerms, [key]: e.target.checked })}
                          className="w-4 h-4 text-purp-700 rounded focus:ring-purp-700"
                        />
                        <span className="text-sm font-medium text-neutral-700 capitalize">{key.replace(/_/g, " ")}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreateCustomRole}
                  disabled={!newRoleName.trim() || creatingRole}
                  className="bg-purp-900 hover:bg-purp-700 text-white font-semibold"
                >
                  {creatingRole ? "Saving..." : "Create Role"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger
              render={<Button className="bg-purp-900 hover:bg-purp-700 text-white font-semibold" />}
            >
              <Plus className="mr-2 h-4 w-4" />
              Invite Member
            </DialogTrigger>
            <DialogContent className="border-2 border-purp-200">
              <DialogHeader>
                <DialogTitle className="text-purp-900">Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to join your business account on PurpLedger.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Email Address *</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="border-2 border-purp-200 bg-purp-50 h-11"
                    placeholder="colleague@company.ng"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role *</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? "")}>
                    <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200">
                      {roles.filter(r => r.name !== "owner").map((role) => (
                        <SelectItem key={role.id} value={role.name}>
                          <span className="capitalize">{role.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleInvite}
                  disabled={!inviteEmail || !inviteRole || sendingInvite}
                  className="bg-purp-900 hover:bg-purp-700 text-white font-semibold"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {sendingInvite ? "Sending..." : "Send Invitation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Current Team */}
      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-purp-900">Active Members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {team.map((member) => {
              const RoleIcon = roleIcons[member.role] || Shield;
              return (
                <div key={member.id} className="flex items-center justify-between p-4 bg-purp-50 border-2 border-purp-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purp-100 border-2 border-purp-200 rounded-full flex items-center justify-center">
                      <Users className="h-5 w-5 text-purp-700" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-purp-900">{member.email}</p>
                      <p className="text-xs text-neutral-500">
                        Joined {new Date(member.joinedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`border-2 text-xs font-semibold capitalize ${roleColors[member.role] || ""}`}>
                    <RoleIcon className="mr-1 h-3 w-3" />
                    {member.role}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Roles Reference */}
      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-purp-900">Role Permissions</CardTitle>
          <p className="text-xs text-neutral-500 mt-1">Reference of what each role can do</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {roles.map((role) => {
              const RoleIcon = roleIcons[role.name] || Shield;
              const permissions = role.permissions;
              const granted = Object.entries(permissions).filter(([, v]) => v);
              const denied = Object.entries(permissions).filter(([, v]) => !v);

              return (
                <div key={role.id} className="p-4 border-2 border-purp-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className={`border-2 text-xs font-semibold capitalize ${roleColors[role.name] || "bg-neutral-100 text-neutral-600 border-neutral-200"}`}>
                      <RoleIcon className="mr-1 h-3 w-3" />
                      {role.name}
                    </Badge>
                    {role.is_system_role && (
                      <span className="text-[10px] text-neutral-400 uppercase tracking-wider">System Role</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {granted.map(([key]) => (
                      <span key={key} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                        ✓ {key.replace(/_/g, " ")}
                      </span>
                    ))}
                    {denied.map(([key]) => (
                      <span key={key} className="text-[10px] bg-neutral-50 text-neutral-400 border border-neutral-200 px-2 py-0.5 rounded-full line-through">
                        {key.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
