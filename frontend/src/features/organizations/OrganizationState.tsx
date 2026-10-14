import styles from "./Organizations.module.css";

export default function OrganizationState({
  unavailable = false,
  retryHref = "/organizations",
}: {
  unavailable?: boolean;
  retryHref?: string;
}) {
  return (
    <section className={styles.container}>
      <h1>
        {unavailable ? "Organização indisponível" : "Sem acesso à organização"}
      </h1>
      <p role="alert">
        {unavailable
          ? "Não foi possível consultar seu acesso. Tente novamente em instantes."
          : "Você não tem um vínculo ativo com as permissões necessárias. Procure o administrador ou o Master da plataforma."}
      </p>
      <div className={styles.actions}>
        {unavailable && <a href={retryHref}>Tentar novamente</a>}
        <a href="/settings">Configurações da conta</a>
      </div>
    </section>
  );
}
