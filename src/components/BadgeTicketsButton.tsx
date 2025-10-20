import { Bell } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNewTicketsIndicator } from '../hooks/useNewTicketsIndicator';
import { useNavigate } from 'react-router-dom';

export default function BadgeTicketsButton() {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const clientId = userBase?.client_id || null;
  const { count, markAsSeen } = useNewTicketsIndicator(clientId, isAdmin);
  const navigate = useNavigate();

  if (!isAdmin) return null;

  const goTickets = async () => {
    await markAsSeen();            // ✅ purge le badge du jour
    navigate('/tickets-admin');    // adapte la route si besoin
  };

  return (
    <button
      onClick={goTickets}
      className="relative p-2 rounded-lg hover:bg-gray-100"
      title="Tickets collaborateurs"
    >
      <Bell className="w-5 h-5 text-gray-700" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
