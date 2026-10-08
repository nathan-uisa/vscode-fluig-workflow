export interface FluigServer {
  id: string;
  name: string;
  baseUrl: string;
  companyId: number;
  username: string;
  password?: string;
  userCode: string;
  isDefault?: boolean;
}

export interface AuthToken {
  token: string;
  expiresAt?: number;
}
