import type { Stage } from "../types/auth";
export function MfaFields({
  stage,
  error,
  secret,
  busy,
  loadSecret,
}: {
  stage: Stage;
  error: string;
  secret: string;
  busy: boolean;
  loadSecret: () => Promise<void>;
}) {
  return (
    <>
      {stage === "setup" && (
        <div className="setup-box">
          {!secret ? (
            <button
              type="button"
              className="secondary"
              onClick={loadSecret}
              disabled={busy}
            >
              Exibir chave de configuração
            </button>
          ) : (
            <>
              <p>
                No autenticador, selecione inserir chave manualmente:
                Application Foundation, baseada em tempo, 6 dígitos, 30
                segundos.
              </p>
              <label htmlFor="totp-secret">Chave de configuração</label>
              <input
                id="totp-secret"
                readOnly
                value={secret}
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          )}
        </div>
      )}
      {(stage === "setup" || stage === "mfa") && (
        <>
          <label htmlFor="code">
            {stage === "setup"
              ? "Código de 6 dígitos"
              : "Código de autenticação ou recuperação"}
          </label>
          <input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={stage === "setup" ? "numeric" : "text"}
            required
            minLength={6}
            maxLength={32}
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "form-error" : undefined}
          />
        </>
      )}
    </>
  );
}
