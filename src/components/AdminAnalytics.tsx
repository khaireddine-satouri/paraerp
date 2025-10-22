import { useEffect, useMemo, useState } from 'react';
import { supabase, Seance, UserBase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ---------------- Types ---------------- */
type Range = { start: string; end: string };

type KPIsNow = {
  a_venir: number;
  en_cours: number;
  en_cours_inactifs: number;
  en_cours_debiteurs: number;
};

type KPIsPeriod = {
  totalEncaissements: number;
  dossiersOuverts: number;
  dossiersClotures: number;
  seancesRealisees: number;
  patientsDistincts: number;
  parPrestataire: {
    prestataire_id: string;
    nom: string;
    prenom: string;
    totalSeances: number;
    encaissement: number;
  }[];
};

/** Filtres de dashboard envoyés lors d’un clic sur une tuile */
type DashFilters = {
  etat: 'all' | 'a_venir' | 'en_cours' | 'termine';
  pec: 'all' | 'oui' | 'non';
  etatPec: 'all' | 'en_cours' | 'depose';
  paiement: 'all' | 'paye' | 'debiteur';
  activite: 'all' | 'actif' | 'inactif';
  dateDebut: string;
  dateFin: string;
  patientSearch: string;
  motifSearch: string;
};

export default function AdminAnalytics({
  onOpenDashboardWithFilters,
}: {
  onOpenDashboardWithFilters?: (filters: DashFilters) => void;
}) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const clientId = userBase?.client_id || null;

  // savoir s'il existe au moins un assistant pour ce client
  const [hasAssistants, setHasAssistants] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const checkAssistants = async () => {
      if (!isAdmin || !clientId) { setHasAssistants(null); return; }
      try {
        const { data, error } = await supabase
          .from('users_base')
          .select('id')
          .eq('client_id', clientId)
          .eq('type_utilisateur', 'assistant')
          .limit(1);
        if (cancelled) return;
        if (error) { console.error('Erreur vérification assistants:', error); setHasAssistants(false); return; }
        setHasAssistants((data?.length ?? 0) > 0);
      } catch (e) {
        if (!cancelled) {
          console.error('Erreur vérification assistants:', e);
          setHasAssistants(false);
        }
      }
    };
    checkAssistants();
    return () => { cancelled = true; };
  }, [isAdmin, clientId]);

  /* ---------------- Utils dates (Tunis) ---------------- */
  const pad2 = (n: number) => String(n).padStart(2, '0');

  /** Récupère la date actuelle en Afrique/Tunis sous forme { y, m0, d } */
  const getTunisYMDNow = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Tunis',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = Number(parts.find(p => p.type === 'year')?.value);
    const m = Number(parts.find(p => p.type === 'month')?.value);
    const d = Number(parts.find(p => p.type === 'day')?.value);
    return { y, m0: m - 1, d };
  };

  /** Construit YYYY-MM-DD (sans conversions de fuseau) */
  const isoFromYMD = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

  /** Dernier jour (nombre) d’un mois donné (indépendant du fuseau) */
  const lastDayNum = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

  const formatDateFR = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  /** Période par défaut en heure de Tunis */
  const computeDefaultRange = (): Range => {
    const { y, m0, d } = getTunisYMDNow();
    if (d === 1) {
      // 1er du mois → tout le mois précédent
      const prevY = m0 === 0 ? y - 1 : y;
      const prevM0 = m0 === 0 ? 11 : m0 - 1;
      return {
        start: isoFromYMD(prevY, prevM0, 1),
        end: isoFromYMD(prevY, prevM0, lastDayNum(prevY, prevM0)),
      };
    }
    // Sinon → du 1er du mois courant à aujourd’hui (inclus)
    return {
      start: isoFromYMD(y, m0, 1),
      end: isoFromYMD(y, m0, d),
    };
  };

  /** Aujourd’hui en ISO (Tunis) */
  const todayTunisISO = useMemo(() => {
    const { y, m0, d } = getTunisYMDNow();
    return isoFromYMD(y, m0, d);
  }, []);

  /* --------------- Filtres période --------------- */
  const [mode, setMode] = useState<'range' | 'month'>('range');
  const [range, setRange] = useState<Range>(computeDefaultRange());
  const [month, setMonth] = useState<string>(todayTunisISO.slice(0, 7)); // YYYY-MM

  const todayYM = todayTunisISO.slice(0, 7);
  const [ySel, mSel] = month.split('-').map(Number);
  const monthsLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

  const setYear = (newY: number) => {
    const candidate = `${newY}-${pad2(mSel)}`;
    setMonth(candidate <= todayYM ? candidate : todayYM);
  };
  const setMonthInYear = (newM: number) => {
    const candidate = `${ySel}-${pad2(newM)}`;
    if (candidate <= todayYM) setMonth(candidate);
  };

  /* --------------- Data --------------- */
  const [loadingNow, setLoadingNow] = useState(true);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [nowKPIs, setNowKPIs] = useState<KPIsNow>({
    a_venir: 0,
    en_cours: 0,
    en_cours_inactifs: 0,
    en_cours_debiteurs: 0,
  });
  const [periodKPIs, setPeriodKPIs] = useState<KPIsPeriod>({
    totalEncaissements: 0,
    dossiersOuverts: 0,
    dossiersClotures: 0,
    seancesRealisees: 0,
    patientsDistincts: 0,
    parPrestataire: [],
  });

  const effectiveRange: Range = useMemo(() => {
    if (mode === 'range') return range;
    const start = isoFromYMD(ySel, mSel - 1, 1);
    const last = lastDayNum(ySel, mSel - 1);
    // On borne la fin au "today Tunis" si le mois sélectionné est le mois courant
    const endFull = isoFromYMD(ySel, mSel - 1, last);
    const end =
      `${ySel}-${pad2(mSel)}` === todayYM
        ? (endFull > todayTunisISO ? todayTunisISO : endFull)
        : endFull;
    return { start, end };
  }, [mode, range, ySel, mSel, todayYM, todayTunisISO]);

  useEffect(() => {
    if (!clientId || !isAdmin) return;
    loadNowKPIs();
  }, [clientId, isAdmin]);

  useEffect(() => {
    if (!clientId || !isAdmin) return;
    loadPeriodKPIs();
  }, [clientId, isAdmin, effectiveRange.start, effectiveRange.end]);

  /* ---------------- Utils ---------------- */
  const tunisDateTime = () =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());

  /* --------------- Chargement instantané --------------- */
  const loadNowKPIs = async () => {
    setLoadingNow(true);
    try {
      const { data: all, error } = await supabase
        .from('dossiers_soins')
        .select('id, etat, est_actif, est_paye')
        .eq('client_id', clientId);
      if (error) throw error;

      const a_venir = all?.filter((d) => d.etat === 'a_venir').length || 0;
      const en_cours = all?.filter((d) => d.etat === 'en_cours').length || 0;
      const en_cours_inactifs = all?.filter((d) => d.etat === 'en_cours' && d.est_actif === false).length || 0;
      const en_cours_debiteurs = all?.filter((d) => d.etat === 'en_cours' && d.est_paye === false).length || 0;

      setNowKPIs({ a_venir, en_cours, en_cours_inactifs, en_cours_debiteurs });
    } catch (e) {
      console.error('Erreur KPIs instant T:', e);
      setNowKPIs({ a_venir: 0, en_cours: 0, en_cours_inactifs: 0, en_cours_debiteurs: 0 });
    } finally {
      setLoadingNow(false);
    }
  };

  /* --------------- Chargement période --------------- */
  const loadPeriodKPIs = async () => {
    setLoadingPeriod(true);
    try {
      const { data: dossiers, error: dErr } = await supabase
        .from('dossiers_soins')
        .select('id, patient_id, created_at, date_fin, etat');
      if (dErr) throw dErr;

      const dossierIds = (dossiers || []).map((d) => d.id);

      // IMPORTANT: ne prendre QUE les séances RÉALISÉES dans la période
      let seances: Seance[] = [];
      if (dossierIds.length > 0) {
        const { data: _seances, error: sErr } = await supabase
          .from('seances')
          .select('id, dossier_id, prestataire_id, montant_paye, date_seance, etat_seance')
          .in('dossier_id', dossierIds)
          .in('etat_seance', ['réalisée', 'realisee'])
          .gte('date_seance', effectiveRange.start)
          .lte('date_seance', effectiveRange.end);
        if (sErr) throw sErr;
        seances = _seances || [];
      }

      // Total encaissements = somme des montants payés des séances réalisées
      const totalEncaissements = seances.reduce((sum, s) => sum + (Number(s.montant_paye) || 0), 0);

      // Séances réalisées = nombre de séances réalisées
      const seancesRealisees = seances.length;

      // Agrégations par prestataire (compte + encaissement)
      const countsByPrestataire: Record<string, number> = {};
      const sumsByPrestataire: Record<string, number> = {};
      for (const s of seances) {
        const k = s.prestataire_id || 'unknown';
        countsByPrestataire[k] = (countsByPrestataire[k] || 0) + 1;
        sumsByPrestataire[k] = (sumsByPrestataire[k] || 0) + (Number(s.montant_paye) || 0);
      }
      const prestataireIds = Object.keys(countsByPrestataire).filter((id) => id !== 'unknown');
      let mapUsers = new Map<string, Pick<UserBase, 'id' | 'nom' | 'prenom'>>();
      if (prestataireIds.length > 0) {
        const { data: users, error: uErr } = await supabase
          .from('users_base')
          .select('id, nom, prenom')
          .in('id', prestataireIds);
        if (uErr) throw uErr;
        mapUsers = new Map((users || []).map((u) => [u.id, u]));
      }
      const parPrestataire: KPIsPeriod['parPrestataire'] = Object.entries(countsByPrestataire).map(
        ([id, totalSeances]) => {
          const u = mapUsers.get(id);
          const encaissement = sumsByPrestataire[id] || 0;
          return {
            prestataire_id: id,
            nom: u?.nom || '',
            prenom: u?.prenom || '',
            totalSeances,
            encaissement,
          };
        }
      );

      // Dossiers ouverts pendant la période (sur created_at)
      const dossiersOuverts =
        dossiers?.filter(
          (d) =>
            d.created_at &&
            d.created_at >= effectiveRange.start &&
            d.created_at <= `${effectiveRange.end}T23:59:59.999Z`,
        ).length || 0;

      // Dossiers clôturés pendant la période (etat=termine + date_fin dans la période)
      const dossiersClotures =
        dossiers?.filter(
          (d) => d.etat === 'termine' && d.date_fin && d.date_fin >= effectiveRange.start && d.date_fin <= effectiveRange.end,
        ).length || 0;

      // Nouveaux patients = patients des dossiers ouverts dans la période
      const patientIds = new Set<string>();
      for (const d of dossiers || []) {
        if (
          d.created_at &&
          d.created_at >= effectiveRange.start &&
          d.created_at <= `${effectiveRange.end}T23:59:59.999Z` &&
          d.patient_id
        ) {
          patientIds.add(d.patient_id);
        }
      }
      const patientsDistincts = patientIds.size;

      setPeriodKPIs({
        totalEncaissements,
        dossiersOuverts,
        dossiersClotures,
        seancesRealisees,
        patientsDistincts,
        parPrestataire,
      });
    } catch (e) {
      console.error('Erreur KPIs période:', e);
      setPeriodKPIs({
        totalEncaissements: 0,
        dossiersOuverts: 0,
        dossiersClotures: 0,
        seancesRealisees: 0,
        patientsDistincts: 0,
        parPrestataire: [],
      });
    } finally {
      setLoadingPeriod(false);
    }
  };

  /* ========================== PDF ========================== */
  const formatTunisTitle = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);

  const formatTunisFooter = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);

  const downloadPDF = () => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const padX = 36;
  const pageW = doc.internal.pageSize.getWidth();
  let y = 40;

  const formatDateFR = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const formatTunisTitle = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  const formatTunisFooter = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);

  // Titre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Analyse — Statistiques', padX, y);
  y += 22;

  // Instantané
  const tsNow = formatTunisTitle(new Date());
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Indicateurs instantanés — ' + tsNow, padX, y);
  y += 10;

  const tilesNow = [
    { label: 'Dossiers à venir', value: String(nowKPIs.a_venir) },
    { label: 'Dossiers en cours', value: String(nowKPIs.en_cours) },
    { label: 'Dossiers en cours inactifs', value: String(nowKPIs.en_cours_inactifs) },
    { label: 'Dossiers en cours débiteurs', value: String(nowKPIs.en_cours_debiteurs) },
  ];
  const cardW = 240, cardH = 64, gap = 14;
  let x = padX;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  for (const t of tilesNow) {
    doc.setDrawColor(225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardW, cardH, 6, 6, 'FD');

    doc.setTextColor(90);
    doc.text(t.label, x + 12, y + 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(20, 115, 108);
    doc.text(t.value, x + 12, y + 46);

    x += cardW + gap;
    if (x + cardW > pageW - padX) {
      x = padX;
      y += cardH + gap;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0);
  }
  y += cardH + 12;

  // Période
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(
    `Indicateurs sur la période du ${formatDateFR(effectiveRange.start)} au ${formatDateFR(effectiveRange.end)}`,
    padX,
    y
  );
  y += 10;

  const tilesPeriod = [
    { label: 'Total encaissements (DT)', value: periodKPIs.totalEncaissements.toFixed(2), color: [20,115,108] as [number,number,number] },
    { label: 'Nouveaux patients', value: String(periodKPIs.patientsDistincts), color: [60,60,60] as [number,number,number] },
    { label: 'Dossiers ouverts', value: String(periodKPIs.dossiersOuverts), color: [60,60,60] as [number,number,number] },
    { label: 'Dossiers clôturés', value: String(periodKPIs.dossiersClotures), color: [60,60,60] as [number,number,number] },
    { label: 'Séances réalisées', value: String(periodKPIs.seancesRealisees), color: [60,60,60] as [number,number,number] },
  ];

  x = padX;
  for (const t of tilesPeriod) {
    doc.setDrawColor(225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardW, cardH, 6, 6, 'FD');

    doc.setTextColor(90);
    doc.text(t.label, x + 12, y + 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...t.color);
    doc.text(t.value, x + 12, y + 46);

    x += cardW + gap;
    if (x + cardW > pageW - padX) {
      x = padX;
      y += cardH + gap;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0);
  }

  // Tableau par prestataire (réalisées uniquement) + Total (DT)
  autoTable(doc, {
  startY: y + cardH + 10,
  head: [['Prestataire', 'Séances réalisées', 'Total (DT)']],
  body:
    periodKPIs.parPrestataire.length > 0
      ? periodKPIs.parPrestataire.map((p) => [
          p.prenom || p.nom ? `${p.prenom} ${p.nom}`.trim() : '—',
          String(p.totalSeances),
          (p.encaissement ?? 0).toFixed(2),
        ])
      : [['—', '0', '0.00']],

  // ✅ styles généraux (lignes grises)
  styles: {
    font: 'helvetica',
    fontSize: 10,
    cellPadding: 6,
    lineColor: [210, 215, 220],   // gris clair
    lineWidth: 0.5,               // épaisseur des bordures
  },

  // ✅ header : fond vert + bordures grises bien visibles
  headStyles: {
    fillColor: [20, 115, 108],    // ton vert
    textColor: 255,
    halign: 'left',
    lineColor: [190, 195, 200],   // gris un poil plus foncé pour l’en-tête
    lineWidth: 0.75,              // bordures header un peu plus épaisses
  },

  columnStyles: {
    1: { halign: 'right' },
    2: { halign: 'right' },
  },

  theme: 'grid',
  margin: { left: 36, right: 36 },
});


  // Pied de page
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  const footerText = `Généré le ${formatTunisFooter(new Date())} (heure de Tunis)`;
  const textWidth = (doc.getStringUnitWidth(footerText) * doc.internal.getFontSize()) / doc.internal.scaleFactor;
  doc.text(footerText, (pageW - textWidth) / 2, doc.internal.pageSize.getHeight() - 18);

  doc.save(`analytics_${effectiveRange.start}_${effectiveRange.end}.pdf`);
};

  if (!isAdmin) {
    return <div className="p-6 text-gray-600">Accès réservé aux administrateurs.</div>;
  }

  /* --------------- UI --------------- */
  return (
    <div className="space-y-6">
      {/* En-tête + bouton PDF */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-4 flex-col lg:flex-row">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-teal-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Analyse</h2>
              <p className="text-gray-600">Indicateurs & statistiques</p>
            </div>
          </div>
          <button
            onClick={downloadPDF}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
          >
            <Download className="w-5 h-5" />
            Télécharger (PDF)
          </button>
        </div>
      </div>

      {/* Indicateurs instantanés — avec horodatage Tunis, tuiles cliquables */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            Indicateurs instantanés — {tunisDateTime()}
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <KpiCard
            asButton
            onClick={() =>
              onOpenDashboardWithFilters?.({
                etat: 'a_venir',
                pec: 'all',
                etatPec: 'all',
                paiement: 'all',
                activite: 'all',
                dateDebut: '',
                dateFin: '',
                patientSearch: '',
                motifSearch: '',
              })
            }
            loading={loadingNow}
            label={<span className="text-sky-600">Dossiers à venir</span>}
            value={nowKPIs.a_venir}
            valueClassName="text-sky-600"
          />
          <KpiCard
            asButton
            onClick={() =>
              onOpenDashboardWithFilters?.({
                etat: 'en_cours',
                pec: 'all',
                etatPec: 'all',
                paiement: 'all',
                activite: 'all',
                dateDebut: '',
                dateFin: '',
                patientSearch: '',
                motifSearch: '',
              })
            }
            loading={loadingNow}
            label={<span className="text-emerald-600">Dossiers en cours</span>}
            value={nowKPIs.en_cours}
            valueClassName="text-emerald-600"
          />
          <KpiCard
            asButton
            onClick={() =>
              onOpenDashboardWithFilters?.({
                etat: 'en_cours',
                pec: 'all',
                etatPec: 'all',
                paiement: 'all',
                activite: 'inactif',
                dateDebut: '',
                dateFin: '',
                patientSearch: '',
                motifSearch: '',
              })
            }
            loading={loadingNow}
            label={<span className="text-amber-600">Dossiers en cours inactifs</span>}
            value={nowKPIs.en_cours_inactifs}
            valueClassName="text-amber-600"
          />
          <KpiCard
            asButton
            onClick={() =>
              onOpenDashboardWithFilters?.({
                etat: 'en_cours',
                pec: 'all',
                etatPec: 'all',
                paiement: 'debiteur',
                activite: 'all',
                dateDebut: '',
                dateFin: '',
                patientSearch: '',
                motifSearch: '',
              })
            }
            loading={loadingNow}
            label={<span className="text-rose-600">Dossiers en cours débiteurs</span>}
            value={nowKPIs.en_cours_debiteurs}
            valueClassName="text-rose-600"
          />
        </div>
      </div>

      {/* Filtres de période */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
          <Filter className="w-4 h-4" />
          <span>Filtres de période</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'range' | 'month')} className="px-2 py-1 bg-transparent">
              <option value="range">Période (dates)</option>
              <option value="month">Par mois</option>
            </select>
          </div>

          {mode === 'range' ? (
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
              <Calendar className="w-5 h-5 text-gray-600" />
              <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} max={todayTunisISO} className="bg-transparent" />
              <span className="text-gray-400">→</span>
              <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} max={todayTunisISO} className="bg-transparent" />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-2 w-full md:w-auto">
              <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                <button type="button" onClick={() => setYear(ySel - 1)} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Année précédente">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="min-w-[72px] text-center font-semibold text-gray-900">{ySel}</span>
                <button
                  type="button"
                  onClick={() => {
                    const candidate = `${ySel + 1}-${pad2(mSel)}`;
                    if (candidate <= todayYM) setYear(ySel + 1);
                  }}
                  className={`p-2 rounded ${`${ySel + 1}-${pad2(mSel)}` > todayYM ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-700'}`}
                  title="Année suivante"
                  disabled={`${ySel + 1}-${pad2(mSel)}` > todayYM}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 sm:grid-cols-6 md:grid-cols-6">
                {monthsLabels.map((lbl, idx) => {
                  const mm = idx + 1;
                  const ymCand = `${ySel}-${pad2(mm)}`;
                  const isActive = month === ymCand;
                  const isFuture = ymCand > todayYM;
                  return (
                    <button
                      key={ymCand}
                      type="button"
                      onClick={() => setMonthInYear(mm)}
                      disabled={isFuture}
                      className={[
                        'px-2 py-2 rounded text-sm',
                        'w-full',
                        isActive ? 'bg-teal-600 text-white' : 'text-gray-700 hover:bg-gray-100',
                        isFuture ? 'opacity-40 cursor-not-allowed' : '',
                      ].join(' ')}
                      title={`${lbl} ${ySel}`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPIs période */}
      <div className="bg-white rounded-xl shadow p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            Indicateurs sur la période du {formatDateFR(effectiveRange.start)} au {formatDateFR(effectiveRange.end)}
          </h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiCard label="Total encaissements (DT)" value={periodKPIs.totalEncaissements.toFixed(2)} loading={loadingPeriod} valueClassName="text-teal-700" />
          <KpiCard label="Nouveaux patients" value={periodKPIs.patientsDistincts} loading={loadingPeriod} valueClassName="text-gray-800" />
          <KpiCard label="Dossiers ouverts" value={periodKPIs.dossiersOuverts} loading={loadingPeriod} valueClassName="text-gray-800" />
          <KpiCard label="Dossiers clôturés" value={periodKPIs.dossiersClotures} loading={loadingPeriod} valueClassName="text-gray-800" />
          <KpiCard label="Séances réalisées" value={periodKPIs.seancesRealisees} loading={loadingPeriod} valueClassName="text-gray-800" />
        </div>

        {/* Tableau par prestataire: Séances réalisées + Total encaissement */}
        {hasAssistants ? (
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Séances par prestataire</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full border divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Prestataire</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Séances réalisées</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Total encaissement (DT)</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPeriod ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-gray-500">Chargement…</td>
                    </tr>
                  ) : periodKPIs.parPrestataire.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-gray-500">Aucune séance sur la période</td>
                    </tr>
                  ) : (
                    periodKPIs.parPrestataire.map((p) => (
                      <tr key={p.prestataire_id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-900">{p.prenom || p.nom ? `${p.prenom} ${p.nom}`.trim() : '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{p.totalSeances}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{p.encaissement.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ----- Composant KPI ----- */
function KpiCard({
  label,
  value,
  loading,
  icon,
  valueClassName,
  asButton = false,
  onClick,
}: {
  label: React.ReactNode;
  value: string | number;
  loading?: boolean;
  icon?: React.ReactNode;
  valueClassName?: string;
  asButton?: boolean;
  onClick?: () => void;
}) {
  const card = (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        {icon}
      </div>
      <div className={`mt-2 text-2xl font-extrabold ${valueClassName ?? 'text-gray-900'}`}>
        {loading ? <span className="animate-pulse text-gray-300">•••</span> : value}
      </div>
    </div>
  );

  if (!asButton) return card;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition hover:scale-[1.01]"
      title="Ouvrir le tableau de bord avec ces filtres"
    >
      {card}
    </button>
  );
}
