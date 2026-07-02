const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/resume', label: 'Resume' },
  { href: '/matches', label: 'Matches' },
];

export default function NavLinks({ current }: { current: 'dashboard' | 'resume' | 'matches' }) {
  return (
    <nav className="flex items-center gap-3 text-sm">
      {LINKS.map((link) => {
        const isCurrent = link.href === `/${current}`;
        return (
          <a
            key={link.href}
            href={link.href}
            className={
              isCurrent
                ? 'text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground transition-colors'
            }
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
