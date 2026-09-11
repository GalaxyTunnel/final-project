export interface NodeConfig {
  id: string;
  name: string;
  protocol: 'vless' | 'trojan';
  port: number;
  tls: boolean;
  link: string;
}

export interface GeneratorParams {
  domain: string;
  uuid: string;
  trojanPass: string;
  wsPath: string;
  cleanIp: string;
  subToken: string;
}
