"use client";

import { CheckCircle2 } from "lucide-react";

const targetUsers = [
  "Agencies",
  "Freelancers",
  "Event Vendors",
  "Schools",
  "Consultants",
  "Contractors",
  "Service Businesses",
];

export function WhoItIsFor() {
  return (
    <section className="bg-[#12061F] py-16 border-t border-white/5">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
        
        <p className="text-sm font-semibold uppercase tracking-widest text-[#B58CFF] mb-4">
          Built For Service Operations
        </p>
        
        <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-8">
          Not for retail. Built for businesses with structured payment workflows.
        </h2>

        <div className="flex flex-wrap justify-center gap-3 md:gap-4">
          {targetUsers.map((user) => (
            <div key={user} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80">
              <CheckCircle2 className="h-4 w-4 text-[#7B2FF7]" />
              {user}
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
