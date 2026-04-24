"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AlertOctagon } from "lucide-react";
import { logoutUser } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export default function SuspendedPage() {
  return (
    <div className="w-full flex flex-col items-center justify-center space-y-6">
      <Card className="max-w-md w-full border-2 border-red-200 shadow-lg">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertOctagon className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-purp-900">Account Suspended</h1>
          <p className="text-neutral-500 pb-4">
            Your PurpLedger merchant account has been suspended by an administrator. You can no longer access your dashboard.
          </p>
          <div className="bg-red-50 p-4 rounded-lg text-left text-sm space-y-2 border border-red-100">
            <p className="font-medium text-red-800">What does this mean?</p>
            <p className="text-red-700">All features including invoicing, team management, and public payment portals are currently disabled.</p>
          </div>
          <div className="pt-4">
            <Button 
              onClick={() => logoutUser()} 
              variant="outline" 
              className="w-full"
            >
              Log out
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-neutral-500">
        Contact support at <a href="mailto:support@purpledger.app" className="text-purp-700 hover:underline">support@purpledger.app</a> for assistance.
      </p>
    </div>
  );
}
