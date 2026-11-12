import { availableParallelism } from 'os';

/**
 * Taille du pool de threads libuv, a fixer AVANT sa premiere utilisation
 * (ce module est importe en tout premier par main.ts).
 *
 * Par defaut libuv n'a que 4 threads, partages entre bcrypt (login), crypto,
 * fs (fichiers /uploads) et DNS (resolution des hotes Atlas). Pendant un pic
 * de logins, bcrypt occupait les 4 threads et tout le reste faisait la queue
 * (test de charge: ~22 logins/s max, 68% de logins > 30 s).
 *
 * Surchargeable via UV_THREADPOOL_SIZE (ex: dans l'ecosystem PM2).
 */
if (!process.env.UV_THREADPOOL_SIZE) {
  const cores = Math.max(1, availableParallelism());
  process.env.UV_THREADPOOL_SIZE = String(Math.min(32, Math.max(8, cores)));
}
