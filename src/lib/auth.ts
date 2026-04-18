import { invoke } from "@tauri-apps/api/core";

export interface Session {
  email: string;
  name: string;
  picture: string;
}

export const checkCredentials = (): Promise<boolean>   => invoke("check_credentials");
export const saveCredentials  = (clientId: string, clientSecret: string): Promise<void> =>
  invoke("save_credentials", { clientId, clientSecret });
export const startOAuth  = (): Promise<Session>        => invoke("start_oauth");
export const getSession  = (): Promise<Session | null> => invoke("get_session");
export const signOut     = (): Promise<void>           => invoke("sign_out");
export const drivePush   = (): Promise<void>           => invoke("drive_push");
export const drivePull   = (): Promise<boolean>        => invoke("drive_pull");
export const pushEvents  = (): Promise<number>         => invoke("push_events");
export const pullEvents  = (): Promise<number>         => invoke("pull_events");
