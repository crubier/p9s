import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "p9s-example-development-secret-change-me");

// A token names the role id of a person, which `current_role_id()` reads back from the settings of the request
export const signToken = (roleId: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(roleId).setAudience("p9s-example").setIssuedAt().setExpirationTime("12h").sign(secret);

export const roleIdOf = async (token: string) => {
  const { payload } = await jwtVerify(token, secret, { audience: "p9s-example", algorithms: ["HS256"] });
  return payload.sub;
};
