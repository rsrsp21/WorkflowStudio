import { authenticateRuntimeToken } from '@/src/storage/runtime-connection-repository';

export async function runtimeFromRequest(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return await authenticateRuntimeToken(authorization.slice('Bearer '.length).trim());
}
