export interface ChatProps {
  onLogout: () => void
}

export function Chat({ onLogout }: ChatProps) {
  void onLogout
  return <div>chat</div>
}
