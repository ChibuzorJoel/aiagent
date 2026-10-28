export type Role = 'member' | 'builder' | 'admin';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  role: Role;
  user: SessionUser;
}

/** What every failed request looks like after ApiService has tidied it up. */
export interface ApiError {
  status: number;   // 0 = the server could not be reached
  code: string;     // 'auth' | 'forbidden' | 'validation' | 'limit' | 'network' | ...
  message: string;  // safe to show to the person
}

/** Events sent by POST /chat/send */
export type ChatEventName = 'start' | 'thinking' | 'delta' | 'tool' | 'approval' | 'done' | 'error';
export interface ChatEvent {
  event: ChatEventName;
  data: any;
}
