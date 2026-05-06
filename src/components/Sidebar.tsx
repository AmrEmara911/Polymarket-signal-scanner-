'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/signals', label: 'Signals' },
    { href: '/reports', label: 'Reports' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <aside className="w-64 bg-[#111827] border-r border-[#1f2937] flex flex-col fixed h-full z-10">
      <div className="p-6 border-b border-[#1f2937]">
        <h1 className="text-xl font-bold text-white tracking-tight">BIT Capital</h1>
        <p className="text-sm text-[#9ca3af] font-medium tracking-widest uppercase mt-1">Signal Scanner</p>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {links.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link 
              key={link.href} 
              href={link.href} 
              className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive 
                  ? 'bg-[#3b82f6] text-white shadow-sm' 
                  : 'text-gray-300 hover:bg-[#1f2937] hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#1f2937]">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse"></div>
          <span className="text-sm text-[#9ca3af]">System Live</span>
        </div>
      </div>
    </aside>
  );
}
