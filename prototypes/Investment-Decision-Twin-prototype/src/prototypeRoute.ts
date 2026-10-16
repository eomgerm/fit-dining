export type PrototypeRoute = 'thesis' | 'taxtrace'

export function getPrototypeRoute(hash: string): PrototypeRoute {
  return hash.toLowerCase() === '#/taxtrace' ? 'taxtrace' : 'thesis'
}

export function resetPrototypeScroll(target: { scrollTop: number }): void {
  target.scrollTop = 0
}
