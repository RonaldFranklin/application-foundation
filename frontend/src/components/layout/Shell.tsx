export default function Shell({
  children,
  master = false,
}: {
  children: React.ReactNode;
  master?: boolean;
}) {
  return (
    <main className="shell">
      <section className="form-panel">
        <a
          className="brand"
          href={master ? "/admin/login" : "/login"}
          aria-label="Application Foundation — início"
        >
          <span className="brand-icon" aria-hidden="true">
            ▥
          </span>
          Application Foundation
        </a>
        <div className="form-content">{children}</div>
        <footer>
          CONSTÂNCIA TRANSFORMA.<span>Application Foundation © {new Date().getFullYear()}</span>
        </footer>
      </section>
      <aside className="art-panel" aria-label="Painel decorativo Application Foundation">
        <div className="art-top">
          <span>UM NOVO RITMO.</span>
          <span>01 — ∞</span>
        </div>
        <div className="sculpture" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="art-bottom">
          <span className="eyebrow">SUA MELHOR VERSÃO, TODOS OS DIAS</span>
          <h2>
            O próximo passo
            <br />
            começa com você.
          </h2>
          <p>Foco no presente. Força para ir além.</p>
          <div className="art-line" />
        </div>
      </aside>
    </main>
  );
}
