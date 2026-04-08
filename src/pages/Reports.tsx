import { FileSpreadsheet, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/useTransactions";

export default function Reports() {
  const { data: transactions } = useTransactions();

  function downloadCSV() {
    const rows = transactions || [];
    const headers = "Date,Vendor,Amount,Category,Account,Entity,Notes\n";
    const csv = rows
      .map((t) => `${t.transaction_date},"${t.vendor}",${t.amount},"${t.category}","${t.account_source}","${t.entity}","${t.notes || ""}"`)
      .join("\n");
    const blob = new Blob([headers + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const reports = [
    {
      title: "CSV Export",
      description: "Download all transactions as a spreadsheet",
      icon: FileSpreadsheet,
      action: downloadCSV,
      actionLabel: "Download CSV",
    },
    {
      title: "Monthly P&L Report",
      description: "Profit & Loss statement for the current month",
      icon: FileText,
      action: () => {},
      actionLabel: "Generate Report",
    },
    {
      title: "Tax Summary for CPA",
      description: "Year-to-date tax summary grouped by category",
      icon: FileText,
      action: () => {},
      actionLabel: "Generate Report",
    },
  ];

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {reports.map((r) => (
        <div key={r.title} className="glass-card rounded-xl p-5 flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary shrink-0">
            <r.icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-card-foreground">{r.title}</p>
            <p className="text-xs text-muted-foreground">{r.description}</p>
          </div>
          <Button variant="outline" className="gap-2 shrink-0" onClick={r.action}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{r.actionLabel}</span>
          </Button>
        </div>
      ))}
    </div>
  );
}
