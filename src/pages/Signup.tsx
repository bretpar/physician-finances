import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PiggyBank, ShieldCheck } from "lucide-react";

export default function Signup() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <PiggyBank className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Invitation Only</CardTitle>
          <CardDescription>
            New accounts can only be created by an organization admin. Please contact your administrator to receive an invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <ShieldCheck className="h-16 w-16 text-muted-foreground/50" />
          <Link to="/login">
            <Button variant="outline">Back to Sign In</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
