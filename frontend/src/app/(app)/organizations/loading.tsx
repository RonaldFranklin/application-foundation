import styles from "@/features/organizations/Organizations.module.css";
export default function Loading() {
  return (
    <p className={styles.empty} role="status">
      Carregando organização…
    </p>
  );
}
