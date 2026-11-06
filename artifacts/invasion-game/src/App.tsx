import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import { Activity, Crosshair, Shield } from 'lucide-react';
import {
  getGetCurrentPlayerQueryKey,
  getGetLeaderboardQueryKey,
  useGetCurrentPlayer,
  useGetLeaderboard,
  useHealthCheck,
  useLoginPlayer,
  useLogoutPlayer,
  usePurchaseWeapon,
  useRegisterPlayer,
  useSubmitMatch,
} from '@workspace/api-client-react';
import type { GetLeaderboardCategory, Player } from '@workspace/api-client-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
type LeaderboardView = 'kills' | 'coins' | 'playtime';
type FormMode = 'login' | 'register';
type FrameMessage =
  | { type: 'game-screen'; screen: string }
  | { type: 'open-leaderboard' }
  | { type: 'match-finished'; match: { matchId: string; kills: number; headshots: number; captures: number; durationSeconds: number } }
  | { type: 'weapon-purchase'; weaponId: string };

function readError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const payload = error.data;
    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error;
  }
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') return error.error;
  if (error instanceof Error) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}

function formatPlaytime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours || days) parts.push(`${hours} h`);
  parts.push(`${minutes} min`);
  return parts.join(' ');
}

function Brand() {
  return <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Crosshair size={20} strokeWidth={2.5} /></span><span className="brand-name">INVASION <span>3D</span></span></Link>;
}

function Header({ user, logout }: { user: Player | null; logout: () => void }) {
  const [location] = useLocation();
  return <header className="topbar">
    <Brand />
    <nav className="top-nav" aria-label="Navigation principale">
      <Link href="/" className={`nav-link ${location === '/' ? 'active' : ''}`} data-testid="link-play">Jouer</Link>
      <Link href="/leaderboard" className={`nav-link ${location === '/leaderboard' ? 'active' : ''}`} data-testid="link-leaderboard">Tableau des scores</Link>
      {user ? <><span className="nav-link" data-testid="text-username">{user.username}</span><button className="nav-button" data-testid="button-logout" onClick={logout}>Déconnexion</button></> :
        <div className="account-links"><Link href="/login" className="nav-button" data-testid="link-login">Connexion</Link><Link href="/register" className="account-create-link" data-testid="link-register">Création de compte</Link></div>}
    </nav>
  </header>;
}

function Game({ user, showLeaderboard, apiStatus }: { user: Player | null; showLeaderboard: () => void; apiStatus: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [screen, setScreen] = useState('menu');
  const [message, setMessage] = useState('');
  const [seenMatch, setSeenMatch] = useState('');
  const queryClient = useQueryClient();
  const submitMatch = useSubmitMatch();
  const purchaseWeapon = usePurchaseWeapon();

  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data;
      if (data.type === 'game-screen' && typeof data.screen === 'string') setScreen(data.screen);
      if (data.type === 'open-leaderboard') showLeaderboard();
      if (data.type === 'match-finished' && data.match && typeof data.match.matchId === 'string' && data.match.matchId !== seenMatch) {
        setSeenMatch(data.match.matchId);
        if (user) {
          submitMatch.mutate({ data: data.match }, { onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetCurrentPlayerQueryKey() });
            (['kills', 'coins', 'playtime'] as GetLeaderboardCategory[]).forEach(category => queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey({ category }) }));
            setMessage('Résultats de la partie enregistrés.');
          }, onError: () => setMessage('Impossible d’enregistrer cette partie.') });
        } else setMessage('Partie terminée — les scores invités ne sont pas sauvegardés.');
      }
      if (data.type === 'weapon-purchase' && typeof data.weaponId === 'string') {
        const allowed = ['smg', 'ak', 'm4', 'shot', 'lmg', 'awp', 'minigun'];
        if (!allowed.includes(data.weaponId)) return;
        const frame = frameRef.current?.contentWindow;
        if (!user) {
          frame?.postMessage({ type: 'purchase-result', weaponId: data.weaponId, error: 'Connectez-vous pour acheter une arme.' }, window.location.origin);
          return;
        }
        purchaseWeapon.mutate({ data: { weaponId: data.weaponId as 'smg' | 'ak' | 'm4' | 'shot' | 'lmg' | 'awp' | 'minigun' } }, {
          onSuccess: response => {
            queryClient.setQueryData(getGetCurrentPlayerQueryKey(), { user: response.user });
             queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey({ category: 'coins' }) });
            frame?.postMessage({ type: 'purchase-result', weaponId: data.weaponId, user: response.user }, window.location.origin);
          },
          onError: error => frame?.postMessage({ type: 'purchase-result', weaponId: data.weaponId, error: readError(error) }, window.location.origin),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [user, seenMatch, showLeaderboard, purchaseWeapon, queryClient, submitMatch]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'account-data', user }, window.location.origin);
  }, [user]);

  return <main className="game-page">
    <div className="game-frame-wrap">
      <iframe ref={frameRef} className="game-frame" src="/game.html" title="Invasion 3D — jeu FPS" allow="fullscreen; pointer-lock; gamepad" onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: 'account-data', user }, window.location.origin)} data-testid="iframe-game" />
    </div>
    <div className="game-footer">
      <span><span className={`live-dot ${apiStatus === 'Serveur indisponible' ? 'offline' : ''}`} />{apiStatus}</span>
      <span data-testid="status-game-screen">{screen}</span>
      <span data-testid="text-match-status">{message || (user ? `Connecté : ${user.username}` : 'Mode invité · scores non sauvegardés')}</span>
    </div>
  </main>;
}

function AuthPage({ mode }: { mode: FormMode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const currentPlayer = useGetCurrentPlayer();
  const register = useRegisterPlayer();
  const login = useLoginPlayer();
  const form = useForm<{ username: string; password: string }>({ defaultValues: { username: '', password: '' } });
  const [localError, setLocalError] = useState('');
  const mutation = mode === 'login' ? login : register;
  const isRegister = mode === 'register';
  const onSubmit = (values: { username: string; password: string }) => {
    setLocalError('');
    mutation.mutate({ data: values }, { onSuccess: response => {
      queryClient.setQueryData(getGetCurrentPlayerQueryKey(), { user: response.user });
      setLocation('/');
    }, onError: error => setLocalError(readError(error)) });
  };
  const checking = currentPlayer.isLoading;
  return <main className="account-page">
    <div className="account-layout">
      <section className="account-art">
        <div><span className="eyebrow">ZONE DE DÉPLOIEMENT / 03</span><h1 className="art-title">Entrez<span>dans l’arène.</span></h1><p className="art-copy">Affrontez les bots, améliorez votre arsenal et inscrivez vos résultats dans le classement mondial.</p></div>
        <div className="art-index">SECTEUR 07 — SESSION EN LIGNE</div>
      </section>
      <section className="form-side">
        <div className="auth-card">
          <span className="eyebrow">{isRegister ? 'NOUVEAU JOUEUR' : 'ACCÈS JOUEUR'}</span>
          <h2 className="auth-title">{isRegister ? 'Création de compte' : 'Connexion'}</h2>
          <p className="auth-subtitle">{isRegister ? 'Votre progression et vos statistiques seront conservées.' : 'Reprenez votre progression là où vous l’avez laissée.'}</p>
           <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} noValidate>
             <FormField control={form.control} name="username" rules={{ required: 'Saisis un pseudo.', pattern: { value: /^[A-Za-z0-9_-]{3,20}$/, message: '3 à 20 caractères : lettres, chiffres, _ ou -.' } }} render={({ field }) => <FormItem className="field"><FormLabel>Pseudo</FormLabel><FormControl><input autoComplete="username" maxLength={20} placeholder="3–20 caractères" data-testid="input-username" {...field} /></FormControl><div className="field-hint">Lettres, chiffres, tiret ou souligné.</div><FormMessage className="form-error" /></FormItem>} />
             <FormField control={form.control} name="password" rules={{ required: 'Saisis ton code.', minLength: { value: 6, message: 'Le code doit contenir au moins 6 caractères.' }, maxLength: { value: 128, message: 'Le code ne peut pas dépasser 128 caractères.' } }} render={({ field }) => <FormItem className="field"><FormLabel>Code</FormLabel><FormControl><input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="6 caractères minimum" data-testid="input-password" {...field} /></FormControl><FormMessage className="form-error" /></FormItem>} />
            {(localError || mutation.isError) && <div className="form-error" role="alert" data-testid="status-auth-error">{localError || readError(mutation.error)}</div>}
            <button className="submit-button" type="submit" disabled={mutation.isPending || checking} data-testid="button-auth-submit">{mutation.isPending ? 'Un instant…' : isRegister ? 'Créer mon compte' : 'Se connecter'}</button>
           </form></Form>
          <p className="auth-switch">{isRegister ? 'Déjà un compte ?' : 'Pas encore de compte ?'} <Link className="text-link" href={isRegister ? '/login' : '/register'} data-testid="link-auth-switch">{isRegister ? 'Connexion' : 'Création de compte'}</Link></p>
          <div className="guest-note"><Link href="/" className="text-link" data-testid="link-guest-access">Continuer en invité</Link><div style={{ marginTop: 6 }}>Sans compte, vos scores ne seront pas conservés.</div></div>
        </div>
      </section>
    </div>
  </main>;
}

const views: { id: LeaderboardView; title: string; label: string; summary: string }[] = [
  { id: 'kills', title: 'Kills', label: 'Kills', summary: 'Éliminations confirmées' },
  { id: 'coins', title: "Le plus d'argent", label: "Le plus d'argent", summary: 'Crédits gagnés en combat' },
  { id: 'playtime', title: 'Le plus de temps', label: 'Le plus de temps', summary: 'Temps total en arène' },
];

function Leaderboard() {
  const [active, setActive] = useState<LeaderboardView>('kills');
  const category: GetLeaderboardCategory = active;
  const result = useGetLeaderboard({ category }, { query: { queryKey: getGetLeaderboardQueryKey({ category }), refetchInterval: 30000 } });
  const activeView = views.find(view => view.id === active)!;
  return <main className="leaderboard-page">
    <div className="leaderboard-content">
      <div className="leaderboard-heading"><div><span className="eyebrow">LES MEILLEURS COMBATTANTS</span><h1 className="leaderboard-title">Tableau <span>des scores</span></h1></div><p className="leaderboard-caption">Les résultats de vrais joueurs. Actualisés toutes les 30 secondes.</p></div>
      <div className="tabs" role="tablist" aria-label="Catégorie du classement">
        {views.map(view => <button key={view.id} className="tab" type="button" role="tab" aria-selected={active === view.id} onClick={() => setActive(view.id)} data-testid={`tab-${view.id}`}>{view.label}</button>)}
      </div>
      <section className="scores-panel" aria-live="polite" data-testid="panel-leaderboard">
        <div className="scores-meta"><span><strong>{activeView.summary}</strong></span><span>{result.data ? `${result.data.entries.length} joueurs` : 'Top 50'}</span></div>
        <div className="score-head"><span>Rang</span><span>Joueur</span><span style={{ textAlign: 'right' }}>{activeView.title}</span></div>
        {result.isLoading ? <div aria-label="Chargement du classement"><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div>
          : result.isError ? <div className="state-error" data-testid="status-leaderboard-error">Le classement est momentanément indisponible.<br /><button className="retry-button" onClick={() => result.refetch()} data-testid="button-retry-leaderboard">Réessayer</button></div>
           : result.data?.entries.length ? result.data.entries.slice(0, 50).map(entry => <div className="score-row" key={`${entry.rank}-${entry.username}`} data-testid={`row-score-${entry.rank}`}><span className="score-rank">#{String(entry.rank).padStart(2, '0')}</span><span className="score-name" data-testid={`text-player-${entry.rank}`}>{entry.username}</span><span className="score-value" data-testid={`text-score-${entry.rank}`}>{active === 'playtime' ? formatPlaytime(entry.score) : active === 'coins' ? `${entry.score.toLocaleString('fr-FR')} pièces` : entry.score.toLocaleString('fr-FR')}</span></div>)
          : <div className="empty-state" data-testid="empty-leaderboard"><div className="empty-icon"><span>—</span></div><h2>Le classement est vierge</h2><p>Les scores s’afficheront ici dès les premières parties enregistrées.</p></div>}
      </section>
      <div className="game-footer" style={{ padding: '16px 0' }}><span><Activity size={13} style={{ verticalAlign: 'middle', marginRight: 7, color: '#e5a841' }} />Mise à jour automatique</span><span><Shield size={13} style={{ verticalAlign: 'middle', marginRight: 7 }} />Scores des joueurs inscrits</span></div>
    </div>
  </main>;
}

function AppShell() {
  const current = useGetCurrentPlayer();
  const logout = useLogoutPlayer();
  const [, setLocation] = useLocation();
  const user = current.data?.user ?? null;
  const showLeaderboard = () => setLocation('/leaderboard');
  const health = useHealthCheck();
  const apiStatus = health.data?.status === 'ok' ? 'Arène opérationnelle' : health.isError ? 'Serveur indisponible' : 'Vérification du serveur';
  const onLogout = () => logout.mutate(undefined, { onSuccess: () => {
    queryClient.setQueryData(getGetCurrentPlayerQueryKey(), { user: null });
    queryClient.clear();
    setLocation('/');
  } });
  return <div className="app-shell"><Header user={user} logout={onLogout} /><Switch>
    <Route path="/"><Game user={user} showLeaderboard={showLeaderboard} apiStatus={apiStatus} /></Route>
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/register"><AuthPage mode="register" /></Route>
    <Route path="/leaderboard"><Leaderboard /></Route>
    <Route component={NotFound} />
  </Switch></div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppShell /></WouterRouter></QueryClientProvider>;
}

export default App;
