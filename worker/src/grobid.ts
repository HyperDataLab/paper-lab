import { Container } from '@cloudflare/containers';

export class GrobidContainer extends Container {
  defaultPort = 8070;
  sleepAfter = '10m';
  enableInternet = false;
}
