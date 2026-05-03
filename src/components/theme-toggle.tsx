"use client";

import { Sun, Moon, Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("purp_theme") as "light" | "dark" | "system";
    if (savedTheme) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    }
  }, []);

  const applyTheme = (t: "light" | "dark" | "system") => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (t === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(t);
    }
  };

  const handleThemeChange = (t: "light" | "dark" | "system") => {
    setTheme(t);
    localStorage.setItem("purp_theme", t);
    applyTheme(t);
  };

  if (!mounted) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-9 w-9 text-neutral-500 hover:text-purp-700 hover:bg-purp-50 transition-colors" />}>
          {theme === "light" && <Sun className="h-5 w-5" />}
          {theme === "dark" && <Moon className="h-5 w-5" />}
          {theme === "system" && <Laptop className="h-5 w-5" />}
          <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-2 border-purp-200">
        <DropdownMenuItem onClick={() => handleThemeChange("light")}>
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("system")}>
          <Laptop className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
