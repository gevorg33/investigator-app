import 'reflect-metadata';
import { bootstrap } from './bootstrap';

// The process entry point and nothing else. What the application applies globally lives in
// bootstrap.ts, where it is tested against a real Nest application.
void bootstrap();
