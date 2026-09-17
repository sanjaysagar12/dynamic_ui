'use client';

import { Bell, LogOut } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Avatar } from '../ui/avatar';

export interface TopBarProps {
  workspaceName: string;
  pageTitle: string;
  userEmail: string;
  userRole: string | null;
  onLogout: () => void;
}

export function TopBar({ workspaceName, pageTitle, userEmail, userRole, onLogout }: TopBarProps) {
  return (
    <div className="shrink-0 flex items-center gap-4 h-[76px] px-8 bg-app">
      <div className="min-w-0">
        <div className="text-[12px] text-tertiary truncate">
          {workspaceName} <span className="mx-1">›</span> {pageTitle}
        </div>
        <h1 className="text-h1 text-primary truncate">{pageTitle}</h1>
      </div>

      <div className="flex-1" />

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Notifications"
            className="relative h-10 w-10 rounded-full flex items-center justify-center text-secondary hover:text-primary hover:bg-surface-hover shrink-0"
          >
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-negative" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0 bg-surface" align="end">
          <div className="px-4 py-3 border-b border-subtle">
            <span className="text-h2 text-primary">Activity Log</span>
          </div>
          <div className="max-h-80 overflow-y-auto px-4 py-6 text-center">
            <p className="text-[13px] text-tertiary">No activity yet.</p>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-2.5 pl-1 shrink-0">
        <Avatar label={userEmail} size={36} />
        <div className="min-w-0 hidden sm:block">
          <div className="text-[13px] font-semibold text-primary truncate">{userEmail.split('@')[0]}</div>
          <div className="text-[11px] text-tertiary truncate">{userRole ?? 'Member'}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
        className="h-10 w-10 rounded-full flex items-center justify-center text-secondary hover:text-negative hover:bg-surface-hover shrink-0"
      >
        <LogOut className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
