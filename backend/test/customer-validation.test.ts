import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CustomerAccess,
  CustomerError,
} from "../src/application/customers/customer-access";
function unavailable<T extends object>(): T {
  return new Proxy({} as T, {
    get() {
      throw new Error("Unexpected dependency access");
    },
  });
}
test("customer commands reject semantic scope injection before any persistence or cryptographic work", async () => {
  type Dependencies = ConstructorParameters<typeof CustomerAccess>;
  const service = new CustomerAccess(
    unavailable<Dependencies[0]>(),
    unavailable<Dependencies[1]>(),
    unavailable<Dependencies[2]>(),
    unavailable<Dependencies[3]>(),
    unavailable<Dependencies[4]>(),
    unavailable<Dependencies[5]>(),
    unavailable<Dependencies[6]>(),
    unavailable<Dependencies[7]>(),
    unavailable<Dependencies[8]>(),
  );
  const cases = [
    () =>
      service.invite(undefined, {
        email: "person@example.invalid",
        organizationId: "foreign",
      }),
    () => service.list(undefined, { organizationId: "foreign" }),
    () => service.update(undefined, { name: "Person", customerId: "other" }),
    () =>
      service.reset({
        token: "bad",
        password: "short",
        confirmPassword: "different",
      }),
    () =>
      service.accept({
        email: "invented@example.invalid",
        token: "bad",
        name: "Person",
        password: "short",
      }),
    () =>
      service.setup(undefined, { password: "test", organizationId: "foreign" }),
    () => service.disable(undefined, { password: "test" }),
    () => service.revokeSession(undefined, { id: "invalid", others: true }),
  ];
  for (const run of cases)
    await assert.rejects(
      run,
      (e: unknown) => e instanceof CustomerError && e.status === 400,
    );
});
