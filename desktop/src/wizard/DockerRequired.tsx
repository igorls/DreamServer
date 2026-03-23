import { useTranslation } from "../i18n";

interface DockerRequiredProps {
  onReady: () => void;
}

/** Shows only if Docker is not detected */
export default function DockerRequired({ onReady }: DockerRequiredProps) {
  const { t } = useTranslation();

  const handleInstall = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_prerequisites", { component: "docker" });
      onReady();
    } catch {
      const { open } = await import("@tauri-apps/plugin-shell");
      open("https://www.docker.com/products/docker-desktop/");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-dream-radial">
      <div className="mb-8">
        <div
          className="w-24 h-24 rounded-2xl flex items-center justify-center"
          style={{ background: "var(--dream-card)", border: "1px solid var(--dream-border)" }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ color: "var(--dream-accent)" }}>
            <rect x="6" y="22" width="36" height="20" rx="3" stroke="currentColor" strokeWidth="2" />
            <rect x="14" y="26" width="6" height="5" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="22" y="26" width="6" height="5" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="30" y="26" width="6" height="5" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="14" y="33" width="6" height="5" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="22" y="33" width="6" height="5" rx="1" fill="currentColor" opacity="0.4" />
            <path d="M18 22V16C18 14.9 18.9 14 20 14H28C29.1 14 30 14.9 30 16V22" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="10" r="2" fill="currentColor" opacity="0.6" />
          </svg>
        </div>
      </div>

      <h2 className="text-2xl font-semibold mb-3 animate-slide-up" style={{ color: "var(--dream-text)" }}>
        {t("docker.title")}
      </h2>
      <p className="text-center max-w-md mb-8 animate-slide-up leading-relaxed" style={{ color: "var(--dream-muted)" }}>
        {t("docker.description")}
      </p>

      <div className="flex flex-col items-center gap-3 animate-slide-up">
        <button onClick={handleInstall} className="btn-primary px-8">
          {t("docker.install")}
        </button>
        <button onClick={onReady} className="btn-ghost">
          {t("docker.alreadyHave")} →
        </button>
      </div>
    </div>
  );
}
