import { instagramUrl, twitterUrl } from "@/lib/format";
import { Mail, ExternalLink } from "lucide-react";

interface SocialLinksProps {
  kennel: {
    facebookUrl: string | null;
    instagramHandle: string | null;
    twitterHandle: string | null;
    discordUrl: string | null;
    mailingListUrl: string | null;
    contactEmail: string | null;
    contactName: string | null;
  };
}

// Inline SVG brand icons (16x16, from Simple Icons — MIT licensed)
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 1.09.044 1.613.115v3.146c-.427-.044-.72-.058-1.03-.058-1.459 0-2.022.694-2.022 2.491v1.864h2.891l-.459 3.667h-2.432v8.117C18.996 22.912 24 17.707 24 12.001 24 5.374 18.627 0 12 0S0 5.374 0 12.001c0 5.628 3.875 10.35 9.101 11.69Z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.03.084c-1.277.06-2.149.264-2.913.558a5.884 5.884 0 0 0-2.126 1.384A5.89 5.89 0 0 0 .607 4.152c-.294.764-.498 1.636-.558 2.913C-.012 8.348-.012 8.79-.012 12s0 3.652.06 4.935c.06 1.277.264 2.149.558 2.913a5.884 5.884 0 0 0 1.384 2.126 5.89 5.89 0 0 0 2.126 1.384c.764.294 1.636.498 2.913.558C8.348 24.012 8.79 24 12 24s3.652 0 4.935-.06c1.277-.06 2.149-.264 2.913-.558a5.884 5.884 0 0 0 2.126-1.384 5.89 5.89 0 0 0 1.384-2.126c.294-.764.498-1.636.558-2.913.06-1.283.06-1.725.06-4.935s0-3.652-.06-4.935c-.06-1.277-.264-2.149-.558-2.913a5.884 5.884 0 0 0-1.384-2.126A5.886 5.886 0 0 0 19.848.607c-.764-.294-1.636-.498-2.913-.558C15.652-.012 15.21-.012 12-.012s-3.652 0-4.935.06L7.03.084ZM12 5.838a6.162 6.162 0 1 1 0 12.324 6.162 6.162 0 0 1 0-12.324ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6.406-11.845a1.44 1.44 0 1 1 0 2.88 1.44 1.44 0 0 1 0-2.88Z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

export function SocialLinks({ kennel }: SocialLinksProps) {
  const links: { label: string; href: string; icon: React.ReactNode }[] = [];

  if (kennel.facebookUrl) {
    links.push({
      label: "Facebook",
      href: kennel.facebookUrl,
      icon: <FacebookIcon className="h-4 w-4" />,
    });
  }
  if (kennel.instagramHandle) {
    links.push({
      label: "Instagram",
      href: instagramUrl(kennel.instagramHandle),
      icon: <InstagramIcon className="h-4 w-4" />,
    });
  }
  if (kennel.twitterHandle) {
    links.push({
      label: "X",
      href: twitterUrl(kennel.twitterHandle),
      icon: <XIcon className="h-4 w-4" />,
    });
  }
  if (kennel.discordUrl) {
    links.push({
      label: "Discord",
      href: kennel.discordUrl,
      icon: <DiscordIcon className="h-4 w-4" />,
    });
  }
  if (kennel.mailingListUrl) {
    links.push({
      label: "Mailing List",
      href: kennel.mailingListUrl,
      icon: <ExternalLink className="h-4 w-4" />,
    });
  }
  if (kennel.contactEmail) {
    links.push({
      label: kennel.contactName || "Email",
      href: `mailto:${kennel.contactEmail}`,
      icon: <Mail className="h-4 w-4" />,
    });
  }

  if (links.length === 0) {
    if (kennel.contactName) {
      return (
        <p className="text-sm text-muted-foreground">
          Contact: {kennel.contactName}
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/20"
          title={link.label}
        >
          {link.icon}
          <span>{link.label}</span>
        </a>
      ))}
    </div>
  );
}
