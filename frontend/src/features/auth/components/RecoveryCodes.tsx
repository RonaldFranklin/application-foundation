export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <>
      {codes.length > 0 ? (
        <ul className="recovery-codes" aria-label="Códigos de recuperação">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice">
          Os códigos já foram exibidos e não podem ser mostrados novamente.
          Mantenha seu autenticador disponível.
        </p>
      )}
      <label className="checkbox">
        <input type="checkbox" required />
        Entendi e guardei meus códigos de recuperação.
      </label>
    </>
  );
}
