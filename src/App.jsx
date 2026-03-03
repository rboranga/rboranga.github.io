import React, { useState, useEffect, useMemo } from 'react';
import { Film, Star, Share2, LogOut, User as UserIcon, Plus, Search, Check, AlertCircle, Copy, LogIn, Filter, BookmarkPlus, Bookmark, Trash2, Shield, FileText, Globe, ListVideo, Heart } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithPopup, GoogleAuthProvider, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc 
} from 'firebase/firestore';

// --- 1. CONFIGURAÇÃO FIREBASE (Fallback para o Canvas) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cine-indica-app';

// --- 2. CONFIGURAÇÃO DA API OMDb ---
const OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY; 

const fetchMovieInfo = async (imdbId) => {
  try {
    const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}&plot=short`);
    const data = await response.json();
    if (data.Response === "True") {
      return { title: data.Title, poster: data.Poster !== 'N/A' ? data.Poster : '', plot: data.Plot };
    }
    throw new Error('Filme não encontrado na API.');
  } catch (error) {
    console.error("Erro ao obter dados:", error);
    throw error;
  }
};

// --- COMPONENTES ---
const StarRating = ({ rating, onRate, readonly }) => {
  const [hoverRating, setHoverRating] = useState(0);

  return (
    <div className="flex space-x-0.5 md:space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer'} transition-colors duration-200`}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          onMouseLeave={() => !readonly && setHoverRating(0)}
          onClick={() => !readonly && onRate(star)}
        >
          <Star
            size={18}
            className={`md:w-6 md:h-6 ${
              (hoverRating || rating) >= star 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-gray-500'
            } ${readonly ? 'opacity-80' : ''}`}
          />
        </button>
      ))}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [movies, setMovies] = useState([]);
  const [savedLists, setSavedLists] = useState([]); 
  const [view, setView] = useState('landing'); // landing, dashboard, publicList, privacy, terms
  const [targetUserId, setTargetUserId] = useState(''); 
  const [friendSearchText, setFriendSearchText] = useState('');
  
  const [imdbLink, setImdbLink] = useState('');
  const [movieStatus, setMovieStatus] = useState('Quero assistir'); 
  const [activeFilter, setActiveFilter] = useState('Todos');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dbError, setDbError] = useState(''); 

  // Inicialização e Auth
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Erro na autenticação inicial:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      // Controlo de vista inicial baseado no login
      const params = new URLSearchParams(window.location.search);
      const sharedUserId = params.get('user');
      
      if (sharedUserId) {
        setTargetUserId(sharedUserId.trim()); 
        setView('publicList');
      } else if (currentUser && !currentUser.isAnonymous) {
        setView('dashboard');
      } else {
        setView('landing');
      }
    });

    return () => unsubscribe();
  }, []);

  // Busca de Filmes Públicos
  useEffect(() => {
    if (!user) return;
    const moviesRef = collection(db, 'artifacts', appId, 'public', 'data', 'recommendations');
    
    const unsubscribe = onSnapshot(moviesRef, (snapshot) => {
      const allMovies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      allMovies.sort((a, b) => b.createdAt - a.createdAt);
      setMovies(allMovies);
      setDbError(''); 
    }, (error) => {
      console.error("Erro ao procurar filmes:", error);
      setDbError(`Erro de ligação à base de dados (${error.code}). Verifique as regras do Firestore!`);
    });

    return () => unsubscribe();
  }, [user]);

  // Busca de Listas Guardadas (Dado Privado)
  useEffect(() => {
    if (!user || user.isAnonymous) {
      setSavedLists([]);
      return;
    }
    
    const savedListsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'savedLists');
    const unsubscribe = onSnapshot(savedListsRef, (snapshot) => {
      const lists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      lists.sort((a, b) => b.createdAt - a.createdAt);
      setSavedLists(lists);
    }, (error) => {
      console.error("Erro ao buscar listas guardadas:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Filtros
  const displayedMovies = useMemo(() => {
    let list = [];
    if (view === 'publicList' && targetUserId) {
      list = movies.filter(m => m.ownerId === targetUserId);
    } else if (view === 'dashboard') {
      list = movies.filter(m => m.ownerId === user?.uid);
    } else if (view === 'landing') {
      // Na landing page mostra os 10 últimos filmes adicionados globalmente (Conteúdo para o AdSense!)
      return movies.slice(0, 10);
    } else {
      return []; 
    }

    if (activeFilter !== 'Todos') {
      list = list.filter(m => (m.status || 'Quero assistir') === activeFilter);
    }
    return list;
  }, [movies, view, targetUserId, user, activeFilter]);

  // HANDLERS DE AUTH
  const handleGoogleLogin = async () => {
    setErrorMsg('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      if (view !== 'publicList') {
        setView('dashboard');
        setActiveFilter('Todos');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao iniciar sessão. Verifique se ativou o Google no painel do Firebase.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
    setView('landing');
    setTargetUserId('');
    setActiveFilter('Todos');
    window.history.pushState({}, document.title, window.location.pathname);
  };

  // HANDLERS DE FILMES
  const handleAddMovie = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    
    if (!user || user.isAnonymous) return;

    const imdbRegex = /imdb\.com(?:\/[a-zA-Z-]+)?\/title\/(tt\d+)/i;
    const match = imdbLink.match(imdbRegex);
    
    if (!match || !match[1]) {
      setErrorMsg('Ligação inválida. Cole um URL do IMDb válido.');
      return;
    }

    const imdbId = match[1];
    if (movies.some(m => m.ownerId === user.uid && m.imdbId === imdbId)) {
      setErrorMsg('Você já indicou este filme!');
      return;
    }

    setIsLoading(true);
    try {
      const movieData = await fetchMovieInfo(imdbId);
      const moviesRef = collection(db, 'artifacts', appId, 'public', 'data', 'recommendations');
      await addDoc(moviesRef, {
        ownerId: user.uid,
        ownerEmail: user.email,
        imdbId: imdbId,
        title: movieData.title,
        poster: movieData.poster,
        plot: movieData.plot,
        status: movieStatus, 
        ratings: {},
        createdAt: Date.now()
      });
      
      setSuccessMsg('Filme adicionado com sucesso!');
      setImdbLink('');
      setMovieStatus('Quero assistir'); 
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg('Erro ao obter dados do filme. Verifique o link e a sua chave da OMDb API.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToMyList = async (movie) => {
    if (!user || user.isAnonymous) {
      alert("Precisa de iniciar sessão para adicionar filmes à sua lista.");
      return;
    }

    if (movies.some(m => m.ownerId === user.uid && m.imdbId === movie.imdbId)) {
      alert("Este filme já está na sua lista!");
      return;
    }

    try {
      const moviesRef = collection(db, 'artifacts', appId, 'public', 'data', 'recommendations');
      await addDoc(moviesRef, {
        ownerId: user.uid,
        ownerEmail: user.email,
        imdbId: movie.imdbId,
        title: movie.title,
        poster: movie.poster,
        plot: movie.plot,
        status: 'Quero assistir', 
        ratings: {},
        createdAt: Date.now()
      });
      alert("Filme adicionado à sua lista com sucesso!");
    } catch (err) {
      console.error("Erro ao guardar o filme:", err);
      alert("Erro ao adicionar filme à sua lista.");
    }
  };

  const handleDeleteMovie = async (movieId) => {
    if (confirm('Deseja realmente remover este filme da sua lista?')) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId));
    }
  };

  const handleUpdateStatus = async (movieId, newStatus) => {
    const movieRef = doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId);
    try {
      await updateDoc(movieRef, { status: newStatus });
    } catch (err) {
      console.error("Erro ao atualizar estado:", err);
      alert("Erro ao guardar o novo estado.");
    }
  };

  const handleRateMovie = async (movieId, currentRatings, ratingValue) => {
    if (!user) return;
    const movieRef = doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId);
    try {
      await updateDoc(movieRef, {
        [`ratings.${user.uid}`]: ratingValue
      });
    } catch (err) {
      console.error("Erro ao votar:", err);
      alert("Erro ao registar o voto. Verifique as regras do Firestore.");
    }
  };

  // HANDLERS DE LISTAS GUARDADAS
  const handleSaveFriendList = async () => {
    if (!user || user.isAnonymous) return;
    const listName = prompt("Dê um nome para esta lista (ex: Filmes do João):");
    if (!listName || listName.trim() === '') return;

    try {
      const savedListsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'savedLists');
      await addDoc(savedListsRef, {
        friendId: targetUserId,
        name: listName.trim(),
        createdAt: Date.now()
      });
      alert("Lista acompanhada com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar lista:", err);
      alert("Erro ao guardar a lista.");
    }
  };

  const handleRemoveSavedList = async (listId) => {
    if (confirm('Deixar de acompanhar esta lista?')) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'savedLists', listId));
      } catch (err) {
        console.error("Erro ao remover lista guardada:", err);
      }
    }
  };

  // CÓPIAS
  const copyShareLink = () => {
    if (!user) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?user=${user.uid}`;
    
    const textArea = document.createElement("textarea");
    textArea.value = shareUrl;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert(`Link copiado! Envie aos seus amigos:\n\n${shareUrl}`);
    } catch (err) {
      alert('O seu link é: ' + shareUrl);
    }
    document.body.removeChild(textArea);
  };

  const copyMyId = () => {
    if (!user) return;
    const textArea = document.createElement("textarea");
    textArea.value = user.uid;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert('O seu Código ID foi copiado com sucesso!');
    } catch (err) {
      alert('Erro ao copiar.');
    }
    document.body.removeChild(textArea);
  };

  const calculateAverageRating = (ratings) => {
    if (!ratings) return 0;
    const values = Object.values(ratings);
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return (sum / values.length).toFixed(1);
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'Favorito': return 'bg-purple-600/90 text-white border-purple-400';
      case 'Assistido': return 'bg-green-600/90 text-white border-green-400';
      case 'Quero assistir': return 'bg-blue-600/90 text-white border-blue-400';
      default: return 'bg-gray-700/90 text-gray-200 border-gray-500'; 
    }
  };

  const isGuest = !user || user.isAnonymous;
  const currentSavedList = savedLists.find(list => list.friendId === targetUserId);

  return (
    <div className="min-h-screen flex flex-col bg-gray-900 text-gray-100 font-sans">
      <header className="bg-gray-800 border-b border-gray-700 shadow-lg sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => { 
              setView(isGuest ? 'landing' : 'dashboard'); 
              setTargetUserId(''); 
              setActiveFilter('Todos');
              window.history.pushState({}, document.title, window.location.pathname);
            }}
          >
            <Film className="text-red-500" size={28} />
            <h1 className="text-xl font-bold tracking-tight text-white">Cine<span className="text-red-500">Indica</span></h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {!isGuest ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-400 hidden sm:inline">{user?.email}</span>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition"
                  title="Sair"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleLogin} 
                className="text-sm px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold flex items-center transition"
              >
                <LogIn size={16} className="mr-2" />
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-grow w-full flex flex-col">
        
        {dbError && (
          <div className="max-w-5xl mx-auto w-full px-4 mt-8 mb-2">
            <div className="bg-red-900/40 border border-red-500 text-red-200 p-4 rounded-xl flex items-center shadow-lg">
               <AlertCircle className="mr-3 flex-shrink-0" size={24} />
               <p>{dbError}</p>
            </div>
          </div>
        )}

        {/* --- LANDING PAGE (Visão rica em conteúdo para Visitantes e Google AdSense) --- */}
        {view === 'landing' && (
          <div className="flex flex-col w-full">
            {/* Hero Section */}
            <div className="bg-gray-800 border-b border-gray-700 py-16 md:py-24 px-4 text-center">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
                  A sua estante virtual de <span className="text-red-500">Filmes</span>
                </h2>
                <p className="text-lg md:text-xl text-gray-400 mb-10 leading-relaxed">
                  Descubra novos filmes, crie a sua lista de favoritos, marque o que já assistiu e partilhe as suas recomendações com amigos de forma fácil e rápida. Tudo num só lugar.
                </p>
                <button 
                  onClick={handleGoogleLogin} 
                  className="bg-white hover:bg-gray-100 text-gray-900 font-bold py-4 px-8 rounded-full text-lg transition shadow-xl flex items-center justify-center mx-auto"
                >
                  <LogIn className="mr-3" size={24} />
                  Começar agora gratuitamente
                </button>
                {errorMsg && <p className="text-red-400 mt-4 text-sm">{errorMsg}</p>}
              </div>
            </div>

            {/* Features Section */}
            <div className="max-w-5xl mx-auto px-4 py-16">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 text-center shadow-lg">
                  <div className="bg-gray-900 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <ListVideo className="text-red-500" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-4">Organize Tudo</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Mantenha um registo perfeito separando os filmes entre "Quero Assistir", "Já Assistidos" e "Favoritos". Nunca mais se esqueça daquele filme que lhe recomendaram.
                  </p>
                </div>
                <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 text-center shadow-lg">
                  <div className="bg-gray-900 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Share2 className="text-red-500" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-4">Partilhe com Amigos</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Gere uma ligação única para o seu perfil e envie aos seus amigos. Eles poderão ver a sua lista e dar notas aos filmes que você recomendou.
                  </p>
                </div>
                <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 text-center shadow-lg">
                  <div className="bg-gray-900 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Globe className="text-red-500" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-4">Acompanhe Outros</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Siga o perfil dos seus amigos, veja o que eles estão a assistir e guarde as listas deles no seu painel para acesso rápido sempre que precisar de inspiração.
                  </p>
                </div>
              </div>
            </div>

            {/* Public Feed Section */}
            <div className="max-w-5xl mx-auto px-4 pb-16 w-full">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-white flex items-center">
                  <Heart className="mr-3 text-red-500" size={28} />
                  Últimas Indicações da Comunidade
                </h3>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                {displayedMovies.length === 0 ? (
                  <div className="col-span-full py-10 text-center text-gray-500">A carregar filmes ou comunidade vazia...</div>
                ) : (
                  displayedMovies.map((movie) => {
                    const avgRating = calculateAverageRating(movie.ratings);
                    return (
                      <div key={movie.id} className="bg-gray-800 rounded-xl overflow-hidden shadow-lg border border-gray-700 flex flex-col relative opacity-90 hover:opacity-100 transition">
                        <div className="relative aspect-[2/3] w-full bg-gray-900 overflow-hidden">
                          <img 
                            src={movie.poster} alt={movie.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute top-0 right-0 bg-black/80 backdrop-blur-sm text-white px-2 py-1 m-2 rounded-md flex items-center text-xs font-bold shadow-md">
                            <Star size={12} className="text-yellow-400 fill-yellow-400 mr-1" />
                            {avgRating}
                          </div>
                        </div>
                        <div className="p-3 flex-grow flex flex-col">
                          <h3 className="text-sm font-bold text-white mb-1 line-clamp-2 leading-snug">{movie.title}</h3>
                          <div className="mt-auto pt-2 border-t border-gray-700/50">
                            <span className="text-[10px] text-gray-500 uppercase">Adicionado recentemente</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ECRÃ DE PRIVACIDADE E TERMOS */}
        {view === 'privacy' && (
          <div className="max-w-3xl mx-auto w-full px-4 py-8">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
               <h2 className="text-2xl font-bold mb-6 flex items-center"><Shield className="mr-3 text-red-500" /> Política de Privacidade</h2>
               <div className="space-y-4 text-gray-300 text-sm leading-relaxed">
                  <p>A sua privacidade é importante para nós. Esta Política de Privacidade explica como o Cine Indica recolhe, utiliza e protege as suas informações.</p>
                  <h3 className="text-lg font-bold text-white mt-6">1. Recolha de Dados</h3>
                  <p>Recolhemos o seu endereço de e-mail e informações básicas de perfil quando inicia sessão com o Google. Estas informações são utilizadas exclusivamente para criar a sua conta, permitir a partilha das suas listas e associar as suas avaliações aos filmes.</p>
                  <h3 className="text-lg font-bold text-white mt-6">2. Cookies e Publicidade de Terceiros</h3>
                  <p>O nosso site utiliza cookies para manter a sua sessão ativa. Adicionalmente, permitimos que empresas de terceiros (como o Google AdSense/AdMob) apresentem anúncios quando visita o nosso site. Estas empresas podem utilizar informações não pessoais (como o tipo de navegador, hora e data, tema dos anúncios clicados) durante as suas visitas a este e outros sites, de forma a apresentar anúncios de bens e serviços que possam ser do seu interesse (cookies DART ou similares).</p>
                  <h3 className="text-lg font-bold text-white mt-6">3. Segurança dos Dados</h3>
                  <p>Todos os dados são armazenados de forma segura utilizando a infraestrutura da Google Cloud (Firebase). As suas listas privadas (como os amigos que acompanha) não são visíveis publicamente.</p>
                  <button onClick={() => setView(isGuest ? 'landing' : 'dashboard')} className="mt-8 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold">Voltar</button>
               </div>
            </div>
          </div>
        )}

        {view === 'terms' && (
          <div className="max-w-3xl mx-auto w-full px-4 py-8">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
               <h2 className="text-2xl font-bold mb-6 flex items-center"><FileText className="mr-3 text-red-500" /> Termos de Uso</h2>
               <div className="space-y-4 text-gray-300 text-sm leading-relaxed">
                  <p>Ao utilizar o Cine Indica, concorda com os seguintes termos:</p>
                  <h3 className="text-lg font-bold text-white mt-6">1. Uso Aceitável</h3>
                  <p>O Cine Indica é uma plataforma para organizar e partilhar indicações de filmes. Compromete-se a não utilizar a plataforma para fins ilícitos, envio de spam ou qualquer atividade que comprometa a infraestrutura do site.</p>
                  <h3 className="text-lg font-bold text-white mt-6">2. Conteúdo Gerado pelo Utilizador</h3>
                  <p>As listas, filmes adicionados e notas dadas são da responsabilidade do utilizador. Reservamo-nos o direito de remover conteúdos ou banir contas que partilhem links maliciosos ou violem as políticas do serviço.</p>
                  <h3 className="text-lg font-bold text-white mt-6">3. Limitação de Responsabilidade</h3>
                  <p>Os dados dos filmes são fornecidos através de APIs públicas (OMDb). Não garantimos a exatidão, disponibilidade contínua ou atualizações instantâneas das sinopses e capas exibidas.</p>
                  <button onClick={() => setView(isGuest ? 'landing' : 'dashboard')} className="mt-8 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold">Voltar</button>
               </div>
            </div>
          </div>
        )}

        {/* PAINEL PRIVADO (Dashboard) */}
        {!isGuest && view === 'dashboard' && (
          <div className="max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
            <div className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">As suas Indicações</h2>
                <p className="text-gray-400 text-sm mb-4">Adicione filmes, organize e partilhe a sua lista.</p>
                
                <div className="flex items-center bg-gray-900 px-3 py-2 rounded-lg border border-gray-700 w-fit">
                   <span className="text-xs text-gray-500 mr-2">O seu Código:</span>
                   <code className="text-sm text-red-400 font-mono select-all">{user?.uid}</code>
                   <button 
                     onClick={copyMyId} 
                     className="ml-3 text-gray-400 hover:text-white transition" 
                     title="Copiar Código"
                   >
                     <Copy size={16} />
                   </button>
                </div>
              </div>
              <button 
                onClick={copyShareLink}
                className="flex items-center px-5 py-3 bg-green-600 hover:bg-green-700 rounded-lg text-white font-bold transition shadow-lg whitespace-nowrap"
              >
                <Share2 size={18} className="mr-2" />
                Copiar Link da Lista
              </button>
            </div>

            <form onSubmit={handleAddMovie} className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700">
              <label className="block text-sm font-medium text-gray-300 mb-2">Cole o link do IMDb do filme:</label>
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-grow">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size={18} className="text-gray-500" />
                  </div>
                  <input
                    type="url" value={imdbLink} onChange={(e) => setImdbLink(e.target.value)} required
                    placeholder="https://www.imdb.com/title/tt0133093/"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-red-500"
                  />
                </div>
                
                <select 
                  value={movieStatus} 
                  onChange={(e) => setMovieStatus(e.target.value)}
                  className="bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-1 focus:ring-red-500 outline-none"
                >
                  <option value="Quero assistir">🍿 Quero assistir</option>
                  <option value="Assistido">✅ Assistido</option>
                  <option value="Favorito">⭐ Favorito</option>
                </select>

                <button type="submit" disabled={isLoading} className="flex items-center justify-center px-6 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg font-bold shadow-md">
                  {isLoading ? 'A procurar...' : <><Plus size={20} className="mr-2"/> Adicionar</>}
                </button>
              </div>
              {successMsg && <p className="text-green-400 text-sm mt-3 flex items-center"><Check size={14} className="mr-1"/> {successMsg}</p>}
              {errorMsg && <p className="text-red-400 text-sm mt-3 flex items-center"><AlertCircle size={14} className="mr-1"/> {errorMsg}</p>}
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Pesquisar novo amigo */}
              <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
                 <h3 className="text-md font-bold text-gray-300 mb-3">Pesquisar lista de um amigo</h3>
                 <div className="flex gap-2">
                   <input 
                     type="text" placeholder="Cole o ID do amigo aqui..."
                     value={friendSearchText} onChange={e => setFriendSearchText(e.target.value)}
                     className="flex-grow bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500 w-full"
                   />
                   <button 
                     onClick={() => { 
                       if(friendSearchText) { 
                         setTargetUserId(friendSearchText.trim()); 
                         setView('publicList'); 
                         setActiveFilter('Todos');
                       } 
                     }}
                     className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
                   >
                     Procurar
                   </button>
                 </div>
              </div>

              {/* Listas Salvas */}
              {savedLists.length > 0 && (
                <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700 flex flex-col h-full max-h-[250px] overflow-y-auto scrollbar-hide">
                   <h3 className="text-md font-bold text-gray-300 mb-3 flex items-center">
                     <Bookmark className="mr-2 text-red-400" size={18}/> Listas Acompanhadas
                   </h3>
                   <div className="flex flex-col gap-2">
                     {savedLists.map(list => (
                       <div key={list.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
                          <div 
                            className="cursor-pointer flex-grow overflow-hidden" 
                            onClick={() => { setTargetUserId(list.friendId); setView('publicList'); setActiveFilter('Todos'); }}
                          >
                             <p className="font-bold text-sm text-gray-200 truncate hover:text-red-400 transition">{list.name}</p>
                          </div>
                          <button 
                            onClick={() => handleRemoveSavedList(list.id)} 
                            className="text-gray-500 hover:text-red-500 ml-3 p-1 transition"
                            title="Deixar de acompanhar"
                          >
                             <Trash2 size={16} />
                          </button>
                       </div>
                     ))}
                   </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LISTA PÚBLICA (Visão do Amigo) */}
        {view === 'publicList' && (
          <div className="max-w-5xl mx-auto w-full px-4 py-8">
            <div className="mb-8 bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-2 flex items-center">
                  <UserIcon className="mr-3 text-red-500" />
                  Lista de Indicações
                </h2>
                <p className="text-gray-400 text-sm mb-2">
                  Veja a organização e avalie os filmes indicados.
                </p>
                <div className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded inline-block">
                  A visualizar ID: <span className="text-red-400 font-mono">{targetUserId}</span>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 mt-4 md:mt-0 w-full md:w-auto">
                {!isGuest && (
                  <button 
                    onClick={currentSavedList ? () => handleRemoveSavedList(currentSavedList.id) : handleSaveFriendList}
                    className={`text-sm px-4 py-2.5 rounded-lg transition font-bold flex items-center justify-center ${
                      currentSavedList 
                        ? 'bg-gray-700 text-green-400 hover:bg-gray-600' 
                        : 'bg-red-600/20 text-red-400 border border-red-500/50 hover:bg-red-600/30'
                    }`}
                  >
                    {currentSavedList ? <Bookmark className="mr-2 fill-current" size={18}/> : <BookmarkPlus className="mr-2" size={18}/>}
                    {currentSavedList ? 'Lista Guardada' : 'Acompanhar Lista'}
                  </button>
                )}
                
                <button 
                  onClick={() => { setView(isGuest ? 'landing' : 'dashboard'); setTargetUserId(''); setActiveFilter('Todos'); window.history.pushState({}, '', window.location.pathname); }}
                  className="text-sm px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition flex justify-center"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- BARRA DE FILTROS & GRELHA DE FILMES --- */}
        {(view === 'dashboard' || view === 'publicList') && (
          <div className="max-w-5xl mx-auto w-full px-4 pb-8">
            <div className="mb-6 flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              <Filter size={20} className="text-gray-500 mr-2 flex-shrink-0" />
              {['Todos', 'Quero assistir', 'Assistido', 'Favorito'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors border ${
                    activeFilter === filter 
                      ? 'bg-gray-700 text-white border-gray-500' 
                      : 'bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800'
                  }`}
                >
                  {filter === 'Todos' ? '📚 Todos' : filter === 'Quero assistir' ? '🍿 Quero assistir' : filter === 'Assistido' ? '✅ Assistido' : '⭐ Favoritos'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
              {displayedMovies.length === 0 ? (
                <div className="col-span-full py-16 text-center text-gray-500">
                  <Film size={48} className="mx-auto mb-4 opacity-20" />
                  <p>{view === 'publicList' ? 'Nenhum filme encontrado para este filtro.' : 'Não encontrou nada aqui! Que tal adicionar um filme?'}</p>
                </div>
              ) : (
                displayedMovies.map((movie) => {
                  const isOwner = user?.uid === movie.ownerId;
                  const userRating = movie.ratings?.[user?.uid] || 0;
                  const totalRatingsCount = movie.ratings ? Object.keys(movie.ratings).length : 0;
                  const avgRating = calculateAverageRating(movie.ratings);
                  
                  const currentStatus = movie.status || 'Quero assistir';

                  return (
                    <div key={movie.id} className="bg-gray-800 rounded-xl overflow-hidden shadow-lg border border-gray-700 flex flex-col group relative">
                      
                      {/* Capa do Filme */}
                      <div className="relative aspect-[2/3] w-full bg-gray-900 overflow-hidden">
                        <img 
                          src={movie.poster} alt={movie.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        
                        <div className={`absolute top-0 left-0 text-[10px] md:text-xs font-bold px-2 py-1 rounded-br-lg shadow-md backdrop-blur-md ${getStatusColor(currentStatus)}`}>
                          {currentStatus === 'Favorito' ? '⭐' : currentStatus === 'Assistido' ? '✅' : '🍿'}
                        </div>

                        <div className="absolute top-0 right-0 bg-black/80 backdrop-blur-sm text-white px-2 py-1 m-1.5 md:m-2 rounded-md flex items-center text-[11px] md:text-sm font-bold shadow-md">
                          <Star size={12} className="text-yellow-400 fill-yellow-400 mr-1" />
                          {avgRating}
                        </div>
                      </div>
                      
                      <div className="p-3 md:p-4 flex-grow flex flex-col">
                        <h3 className="text-sm md:text-base font-bold text-white mb-1 line-clamp-2 leading-snug" title={movie.title}>{movie.title}</h3>
                        
                        <p className="hidden md:block text-xs text-gray-400 mb-3 line-clamp-3 flex-grow">{movie.plot}</p>
                        
                        <div className="mt-auto pt-2 md:pt-4 border-t border-gray-700 flex-grow-0">
                          {isOwner ? (
                            <div className="space-y-2 md:space-y-3">
                              <div className="flex flex-col space-y-1">
                                <select 
                                  value={currentStatus}
                                  onChange={(e) => handleUpdateStatus(movie.id, e.target.value)}
                                  className={`text-[11px] md:text-xs p-1 rounded font-bold focus:outline-none focus:ring-1 focus:ring-gray-400 w-full truncate ${getStatusColor(currentStatus)}`}
                                >
                                  <option value="Quero assistir" className="bg-gray-800 text-white">Quero assistir</option>
                                  <option value="Assistido" className="bg-gray-800 text-white">Assistido</option>
                                  <option value="Favorito" className="bg-gray-800 text-white">Favorito</option>
                                </select>
                              </div>
                              
                              <div className="flex justify-between items-center pt-1 md:pt-2 border-t border-gray-700/50">
                                <div className="text-[10px] md:text-xs text-gray-400 truncate pr-1">
                                  {totalRatingsCount} {totalRatingsCount === 1 ? 'voto' : 'votos'}
                                </div>
                                <button onClick={() => handleDeleteMovie(movie.id)} className="text-[10px] md:text-xs text-red-400 hover:text-red-300 font-medium">
                                  Remover
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1 md:space-y-2">
                              <p className="text-[10px] md:text-xs text-gray-400 font-medium truncate">A sua nota:</p>
                              <StarRating rating={userRating} onRate={(val) => handleRateMovie(movie.id, movie.ratings, val)} readonly={false} />
                              
                              {!user?.isAnonymous && !movies.some(m => m.ownerId === user?.uid && m.imdbId === movie.imdbId) ? (
                                <button 
                                  onClick={() => handleSaveToMyList(movie)}
                                  className="mt-2 w-full text-[10px] md:text-xs bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded transition flex items-center justify-center"
                                >
                                  <Plus size={12} className="mr-1" /> Adicionar à minha lista
                                </button>
                              ) : !user?.isAnonymous ? (
                                <div className="mt-2 w-full text-[10px] md:text-xs bg-green-900/30 text-green-400 py-1.5 rounded text-center border border-green-800/50">
                                  ✓ Na sua lista
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* RODAPÉ (FOOTER) ADMOB / ADSENSE READY */}
      <footer className="bg-gray-900 border-t border-gray-800 mt-auto py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-gray-500 text-sm flex items-center">
            <Film className="mr-2" size={16} />
            &copy; {new Date().getFullYear()} Cine Indica. Todos os direitos reservados.
          </div>
          <div className="flex space-x-6 text-sm font-medium">
            <button onClick={() => setView('privacy')} className="text-gray-400 hover:text-white transition">Política de Privacidade</button>
            <button onClick={() => setView('terms')} className="text-gray-400 hover:text-white transition">Termos de Uso</button>
          </div>
        </div>
      </footer>
    </div>
  );
}