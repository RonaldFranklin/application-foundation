import type { Stage } from "../types/auth";
export function CredentialFields({
  stage,
  error,
  show,
  setShow,
  confirmPassword = false,
}: {
  confirmPassword?: boolean;
  stage: Stage;
  error: string;
  show: boolean;
  setShow: (show: boolean) => void;
}) {
  return (
    <>
      {stage === "login" && (
        <>
          <label htmlFor="identifier">E-mail ou usuário</label>
          <input
            id="identifier"
            name="identifier"
            autoComplete="username"
            placeholder="Seu e-mail ou usuário"
            required
            maxLength={254}
            spellCheck={false}
            aria-describedby={error ? "form-error" : undefined}
          />
        </>
      )}
      {(stage === "login" || stage === "password") && (
        <>
          <label htmlFor="password">
            {stage === "password" ? "Nova senha" : "Senha"}
          </label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete={
                stage === "login" ? "current-password" : "new-password"
              }
              placeholder={
                stage === "login" ? "Sua senha" : "Uma frase longa e memorável"
              }
              required
              minLength={stage === "password" ? 15 : 1}
              maxLength={1024}
              aria-describedby={error ? "form-error" : undefined}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={show}
            >
              {show ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </>
      )}
      {stage === "password" && confirmPassword && (
        <>
          <label htmlFor="confirm-password">Confirmar nova senha</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            maxLength={1024}
            aria-describedby={error ? "form-error" : undefined}
          />
        </>
      )}
    </>
  );
}
