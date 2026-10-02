"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/**
 * The exact header row + a handful of sample rows users can hand-edit. The
 * sample data is illustrative only — replace it with real contacts before
 * uploading. Xem auto-detects every column header, so any custom column
 * (`industry`, `website`, `pain_point`, etc.) becomes a `{{ key }}` merge tag
 * in cold-email templates.
 *
 * Kept inline (no fetch round-trip) so the button works offline and there's no
 * extra API surface to maintain.
 */
const TEMPLATE_CSV = `email,first_name,last_name,company,title,city,country,linkedin,industry,website
[email protected],Priya,Sharma,Acme Robotics,Head of Growth,Mumbai,India,https://linkedin.com/in/priyasharma,SaaS,https://acme.com
[email protected],Rohan,Verma,Northwind Logistics,Operations Director,Bangalore,India,https://linkedin.com/in/rohanverma,Logistics,https://northwind.example
[email protected],Anita,Patel,Globex Health,VP Engineering,Pune,India,https://linkedin.com/in/anitapatel,HealthTech,https://globex-health.example
[email protected],Vikram,Singh,Initech Cloud,CTO,Hyderabad,India,https://linkedin.com/in/vikramsingh,Cloud Infrastructure,https://initech-cloud.example
[email protected],Neha,Gupta,Soylent Foods,Marketing Lead,Delhi,India,https://linkedin.com/in/nehagupta,FMCG,https://soylent.example
[email protected],Arjun,Kumar,Umbrella Pharma,Product Manager,Chennai,India,https://linkedin.com/in/arjunkumar,Pharma,https://umbrella.example
[email protected],Sneha,Reddy,Tyrell Robotics,Founder,Bangalore,India,https://linkedin.com/in/snehareddy,Robotics,https://tyrell.example
[email protected],Karan,Mehta,Hooli Marketing,Demand Generation Manager,Gurgaon,India,https://linkedin.com/in/karanmehta,MarTech,https://hooli.example
`;

export interface DownloadCsvTemplateProps {
  variant?: "button" | "link";
  className?: string;
  fileName?: string;
}

/**
 * Triggers a browser download of the cold-email contacts CSV template.
 *
 * Use the `button` variant on page headers (next to "Add contact", "Import")
 * and the `link` variant inside dialog descriptions where a button would feel
 * heavy.
 */
export function DownloadCsvTemplate({
  variant = "button",
  className,
  fileName = "cold-email-contacts-template.csv",
}: DownloadCsvTemplateProps) {
  const trigger = () => {
    if (typeof window === "undefined") return;
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={trigger}
        className={className ?? "text-xs font-medium text-primary underline-offset-2 hover:underline"}
      >
        Download a sample CSV
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={trigger}
      className={className ?? "gap-2"}
      title="Download a starter CSV with all supported columns"
    >
      <Download className="h-4 w-4" />
      Template
    </Button>
  );
}