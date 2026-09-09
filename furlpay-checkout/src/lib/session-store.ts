const store = new Map<string, any>();

export async function saveSession(session: any) {
  store.set(session.id, session);
}

export async function getSession(id: string) {
  return store.get(id);
}
