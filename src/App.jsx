import React, { useState, useEffect, useMemo } from 'react';
import { Film, Star, Share2, LogOut, User as UserIcon, Plus, Search, Check, AlertCircle, Copy, LogIn, Filter, BookmarkPlus, Bookmark, Trash2, Shield, FileText, Globe, ListVideo, Heart, HelpCircle, Info, Sparkles, ChevronDown, Users } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithPopup, GoogleAuthProvider, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc 
} from 'firebase/firestore';

// --- 1. CONFIGURAÇÃO FIREBASE (Tratamento para evitar erros de compilação no Canvas) ---
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

// --- 2. CONFIGURAÇÃO DAS APIs (OMDb e Gemini) ---
const OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Busca por ID (Usado na adição manual via link IMDb)
const fetchMovieInfoById = async (imdbId) => {
  try {
    const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}&plot=short`);
    const data = await response.json();
    if (data.Response === "True") {
      return { imdbId: imdbId, title: data.Title, poster: data.Poster !== 'N/A' ? data.Poster : '', plot: data.Plot };
    }
    throw new Error('Filme não encontrado na API.');
  } catch (error) {
    console.error("Erro ao obter dados por ID:", error);
    throw error;
  }
};

// Busca por Título Original (Usado pela IA para maior precisão)
const fetchMovieInfoByTitle = async (title) => {
  try {
    // Adicionamos &type=movie para garantir que não tragamos séries ou episódios
    const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&type=movie&apikey=${OMDB_API_KEY}&plot=short`);
    const data = await response.json();
    if (data.Response === "True") {
      return { imdbId: data.imdbID, title: data.Title, poster: data.Poster !== 'N/A' ? data.Poster : '', plot: data.Plot };
    }
    throw new Error('Filme não encontrado na API pelo título.');
  } catch (error) {
    console.error("Erro ao obter dados por título:", error);
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
  const [view, setView] = useState('landing'); 
  const [targetUserId, setTargetUserId] = useState(''); 
  const [friendSearchText, setFriendSearchText] = useState('');
  
  // Controle das Sanfonas (Accordions)
  const [expandedSection, setExpandedSection] = useState('ai'); // Inicializa com a IA aberta

  // Estados de Input Manual
  const [imdbLink, setImdbLink] = useState('');
  const [movieStatus, setMovieStatus] = useState('Quero assistir'); 
  const [activeFilter, setActiveFilter] = useState('Todos');
  const [sortBy, setSortBy] = useState('recentes');
  
  // Estados da Pesquisa com IA
  const [aiQuery, setAiQuery] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiErrorMsg, setAiErrorMsg] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dbError, setDbError] = useState(''); 

  const navigateTo = (newView) => {
    setView(newView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleSection = (section) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  // --- Efeito para injetar o Ícone da Aba (Favicon) ---
  useEffect(() => {
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>`;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${svgIcon}`;
  }, []);

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

  useEffect(() => {
    if (!user) return;
    const moviesRef = collection(db, 'artifacts', appId, 'public', 'data', 'recommendations');
    const unsubscribe = onSnapshot(moviesRef, (snapshot) => {
      const allMovies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      allMovies.sort((a, b) => b.createdAt - a.createdAt);
      setMovies(allMovies);
      setDbError(''); 
    }, (error) => {
      setDbError(`Erro de ligação à base de dados (${error.code}).`);
    });
    return () => unsubscribe();
  }, [user]);

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
    });
    return () => unsubscribe();
  }, [user]);

  const displayedMovies = useMemo(() => {
    let list = [];
    if (view === 'publicList' && targetUserId) {
      list = movies.filter(m => m.ownerId === targetUserId);
    } else if (view === 'dashboard') {
      list = movies.filter(m => m.ownerId === user?.uid);
    } else if (view === 'landing') {
      return movies.slice(0, 10);
    } else {
      return []; 
    }
    
    if (activeFilter !== 'Todos') {
      list = list.filter(m => (m.status || 'Quero assistir') === activeFilter);
    }
    
    if (sortBy === 'recentes') {
      list.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sortBy === 'antigos') {
      list.sort((a, b) => a.createdAt - b.createdAt);
    } else if (sortBy === 'nota') {
      list.sort((a, b) => {
        const getRating = (movie) => {
          if (!movie.ratings) return 0;
          const vals = Object.values(movie.ratings);
          return vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : 0;
        };
        return getRating(b) - getRating(a);
      });
    }
    return list;
  }, [movies, view, targetUserId, user, activeFilter, sortBy]);

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      if (view !== 'publicList') {
        navigateTo('dashboard');
        setActiveFilter('Todos');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao iniciar sessão. Verifique o Google no painel do Firebase.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
    navigateTo('landing');
    setTargetUserId('');
    setActiveFilter('Todos');
    window.history.pushState({}, document.title, window.location.pathname);
  };

  // --- FUNÇÃO DE PESQUISA COM GEMINI (Melhorada para títulos originais) ---
  const handleAiSearch = async (e) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    
    setIsAiLoading(true);
    setAiErrorMsg('');
    setAiSuggestions([]);
    
    try {
      if (!GEMINI_API_KEY || GEMINI_API_KEY === 'SUA_CHAVE_GEMINI') {
         throw new Error("Chave do Gemini não encontrada no ficheiro .env local.");
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const payload = {
        contents: [{ parts: [{ text: `Aja como um especialista em cinema. Sugira exatamente 5 filmes de alta qualidade (não indique séries, desenhos animados longos ou podcasts) que se encaixem perfeitamente neste tema: "${aiQuery}". Retorne APENAS um JSON com uma lista de objetos contendo o titulo do filme no idioma original de cada filme.` }] }],
        generationConfig: { 
          responseMimeType: "application/json", 
          responseSchema: { 
            type: "ARRAY", 
            items: { 
              type: "OBJECT", 
              properties: { originalTitle: { type: "STRING", description: "O título oficial do filme no seu idioma original (ex: City of God)." } },
              required: ["originalTitle"]
            } 
          } 
        }
      };
      
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `Falha na requisição (Status ${res.status})`);
      }
      
      const data = await res.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!textResponse) throw new Error('A IA não retornou resultados válidos.');
      
      const parsedTitles = JSON.parse(textResponse);
      
      const suggestions = [];
      for (const item of parsedTitles) {
        if (item.originalTitle) {
          try {
            const movieData = await fetchMovieInfoByTitle(item.originalTitle);
            suggestions.push(movieData);
          } catch (omdbErr) {
            console.warn(`Filme "${item.originalTitle}" não encontrado no OMDb.`);
          }
        }
      }
      
      if (suggestions.length === 0) {
        setAiErrorMsg("Não foi possível carregar as capas dos filmes sugeridos no momento.");
      } else {
        setAiSuggestions(suggestions);
      }
      
    } catch (err) {
      console.error("Erro da IA:", err);
      setAiErrorMsg(`Aviso da IA: ${err.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAddMovie = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!user || user.isAnonymous) return;

    const imdbRegex = /imdb\.com(?:\/[a-zA-Z-]+)?\/title\/(tt\d+)/i;
    const match = imdbLink.match(imdbRegex);
    
    if (!match || !match[1]) {
      setErrorMsg('Ligação inválida. Utilize um link do IMDb.');
      return;
    }
    const imdbId = match[1];
    if (movies.some(m => m.ownerId === user.uid && m.imdbId === imdbId)) {
      setErrorMsg('Este filme já faz parte da sua lista!');
      return;
    }

    setIsLoading(true);
    try {
      const movieData = await fetchMovieInfoById(imdbId);
      const moviesRef = collection(db, 'artifacts', appId, 'public', 'data', 'recommendations');
      await addDoc(moviesRef, {
        ownerId: user.uid,
        ownerEmail: user.email,
        imdbId: movieData.imdbId,
        title: movieData.title,
        poster: movieData.poster,
        plot: movieData.plot,
        status: movieStatus, 
        ratings: {},
        createdAt: Date.now()
      });
      setSuccessMsg('Filme adicionado!');
      setImdbLink('');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg('Erro ao obter dados do filme.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToMyList = async (movie, defaultStatus = 'Quero assistir') => {
    if (!user || user.isAnonymous) return;
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
        status: defaultStatus, 
        ratings: {},
        createdAt: Date.now()
      });
      alert(`"${movie.title}" adicionado à sua lista!`);
    } catch (err) {
      alert("Erro ao adicionar filme.");
    }
  };

  const handleDeleteMovie = async (movieId) => {
    if (confirm('Remover este filme da lista?')) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId));
    }
  };

  const handleUpdateStatus = async (movieId, newStatus) => {
    const movieRef = doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId);
    try {
      await updateDoc(movieRef, { status: newStatus });
    } catch (err) {
      alert("Erro ao atualizar estado.");
    }
  };

  const handleRateMovie = async (movieId, currentRatings, ratingValue) => {
    if (!user) return;
    const movieRef = doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId);
    try {
      await updateDoc(movieRef, { [`ratings.${user.uid}`]: ratingValue });
    } catch (err) {
      alert("Erro ao votar.");
    }
  };

  const handleSaveFriendList = async () => {
    if (!user || user.isAnonymous) return;
    const listName = prompt("Dê um nome para esta lista:");
    if (!listName || listName.trim() === '') return;
    try {
      const savedListsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'savedLists');
      await addDoc(savedListsRef, { friendId: targetUserId, name: listName.trim(), createdAt: Date.now() });
      alert("Lista guardada!");
    } catch (err) {
      alert("Erro ao guardar lista.");
    }
  };

  const handleRemoveSavedList = async (listId) => {
    if (confirm('Deixar de acompanhar esta lista?')) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'savedLists', listId));
      } catch (err) {}
    }
  };

  const copyShareLink = () => {
    if (!user) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?user=${user.uid}`;
    const textArea = document.createElement("textarea");
    textArea.value = shareUrl;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    alert(`Link copiado: ${shareUrl}`);
    document.body.removeChild(textArea);
  };

  const copyMyId = () => {
    if (!user) return;
    const textArea = document.createElement("textarea");
    textArea.value = user.uid;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    alert('Código ID copiado!');
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
      <header className="bg-gray-800 border-b border-gray-700 shadow-lg sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => { 
              navigateTo(isGuest ? 'landing' : 'dashboard'); 
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
                <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[150px]">{user?.email}</span>
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
          <div className="max-w-5xl mx-auto w-full px-4 mt-8">
            <div className="bg-red-900/40 border border-red-500 text-red-200 p-4 rounded-xl flex items-center">
               <AlertCircle className="mr-3 flex-shrink-0" size={24} />
               <p className="text-sm">{dbError}</p>
            </div>
          </div>
        )}

        {/* --- LANDING PAGE --- */}
        {view === 'landing' && (
          <div className="flex flex-col w-full animate-in fade-in duration-500">
            <div className="bg-gray-800 border-b border-gray-700 py-16 md:py-24 px-4 text-center">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
                  A sua estante virtual de <span className="text-red-500">Filmes</span>
                </h2>
                <p className="text-lg md:text-xl text-gray-400 mb-10 leading-relaxed">
                  Descubra novos filmes através da Inteligência Artificial, organize as suas visualizações e partilhe as suas recomendações.
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
            
            <div className="max-w-5xl mx-auto px-4 py-16">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { icon: <ListVideo className="text-red-500" />, title: "Organize Tudo", desc: "Marque o que quer assistir e guarde os seus favoritos." },
                  { icon: <Share2 className="text-red-500" />, title: "Partilhe", desc: "Gere links únicos e envie as suas recomendações a amigos." },
                  { icon: <Globe className="text-red-500" />, title: "Acompanhe", desc: "Siga o que os seus amigos estão a ver em tempo real." },
                  { icon: <Sparkles className="text-yellow-400" />, title: "Sugestões IA", desc: "Peça sugestões à nossa IA sobre qualquer tema ou gênero." }
                ].map((item, idx) => (
                  <div key={idx} className="bg-gray-800 p-6 rounded-2xl border border-gray-700 text-center shadow-lg hover:border-gray-500 transition">
                    <div className="bg-gray-900 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                      {item.icon}
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800 border-t border-gray-700 py-16">
              <div className="max-w-4xl mx-auto px-4">
                <div className="mb-12">
                  <h3 className="text-2xl font-bold text-white flex items-center mb-4"><Info className="mr-3 text-red-500" /> Sobre o Cine Indica</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    O Cine Indica nasceu da paixão pelo cinema e da necessidade de ter um espaço simples para guardar os títulos que não queremos esquecer. 
                    Utilizamos bases de dados mundiais para garantir que encontra qualquer filme com facilidade.
                  </p>
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white flex items-center mb-6"><HelpCircle className="mr-3 text-red-500" /> Perguntas Frequentes</h3>
                  <div className="space-y-4">
                    <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
                      <h4 className="font-bold text-sm text-white mb-1">O serviço é gratuito?</h4>
                      <p className="text-gray-400 text-xs">Sim, todas as funcionalidades de criação de lista e IA são 100% gratuitas.</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
                      <h4 className="font-bold text-sm text-white mb-1">Como partilhar?</h4>
                      <p className="text-gray-400 text-xs">Após o login, basta clicar em "Copiar Link da Lista" no seu painel principal.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-16 w-full">
              <h3 className="text-2xl font-bold text-white flex items-center mb-8"><Heart className="mr-3 text-red-500" /> Indicações da Comunidade</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {movies.slice(0, 10).map((movie) => (
                  <div key={movie.id} className="bg-gray-800 rounded-xl overflow-hidden shadow-lg border border-gray-700 flex flex-col group">
                    <div className="relative aspect-[2/3] w-full bg-gray-900">
                      <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition" />
                    </div>
                    <div className="p-3">
                      <h3 className="text-xs font-bold text-white truncate">{movie.title}</h3>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ECRÃS DE PRIVACIDADE E TERMOS (Restaurados) */}
        {view === 'privacy' && (
          <div className="max-w-3xl mx-auto w-full px-4 py-8 animate-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
               <h2 className="text-2xl font-bold mb-6 flex items-center"><Shield className="mr-3 text-red-500" /> Política de Privacidade</h2>
               <div className="space-y-4 text-gray-300 text-sm leading-relaxed">
                  <p>A sua privacidade é fundamental. Esta política explica como gerimos os seus dados.</p>
                  <h3 className="text-lg font-bold text-white mt-6">1. Recolha de Dados</h3>
                  <p>Recolhemos o seu e-mail e nome básico via Google Login para gerir a sua conta e associar as suas listas de filmes.</p>
                  <h3 className="text-lg font-bold text-white mt-6">2. Publicidade e Cookies</h3>
                  <p>Utilizamos cookies de sessão. Podemos permitir anúncios de terceiros (Google AdSense) que podem utilizar dados não sensíveis para exibir anúncios relevantes.</p>
                  <h3 className="text-lg font-bold text-white mt-6">3. Segurança</h3>
                  <p>Os seus dados são encriptados e guardados nos servidores seguros da Google Cloud (Firebase).</p>
                  <button onClick={() => navigateTo(isGuest ? 'landing' : 'dashboard')} className="mt-8 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition">Voltar</button>
               </div>
            </div>
          </div>
        )}
        
        {view === 'terms' && (
          <div className="max-w-3xl mx-auto w-full px-4 py-8 animate-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
               <h2 className="text-2xl font-bold mb-6 flex items-center"><FileText className="mr-3 text-red-500" /> Termos de Uso</h2>
               <div className="space-y-4 text-gray-300 text-sm leading-relaxed">
                  <p>Ao utilizar o Cine Indica, concorda com:</p>
                  <h3 className="text-lg font-bold text-white mt-6">1. Uso Pessoal</h3>
                  <p>O site é destinado ao uso pessoal e organização de conteúdos cinematográficos.</p>
                  <h3 className="text-lg font-bold text-white mt-6">2. Responsabilidade do Conteúdo</h3>
                  <p>As listas criadas são da responsabilidade do utilizador. Não nos responsabilizamos por links externos ou opiniões expressas.</p>
                  <h3 className="text-lg font-bold text-white mt-6">3. API de Terceiros</h3>
                  <p>Dependemos das APIs do OMDb e Gemini. Não garantimos a disponibilidade constante destes serviços externos.</p>
                  <button onClick={() => navigateTo(isGuest ? 'landing' : 'dashboard')} className="mt-8 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition">Voltar</button>
               </div>
            </div>
          </div>
        )}

        {/* --- PAINEL PRIVADO (Dashboard com Sanfonas) --- */}
        {!isGuest && view === 'dashboard' && (
          <div className="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
            
            {/* Header Dashboard */}
            <div className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">Painel de Indicações</h2>
                <div className="flex items-center bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-700 w-fit mt-2">
                   <span className="text-[10px] text-gray-500 mr-2 uppercase tracking-wider">O meu ID:</span>
                   <code className="text-xs text-red-400 font-mono select-all truncate max-w-[120px]">{user?.uid}</code>
                   <button onClick={copyMyId} className="ml-2 text-gray-400 hover:text-white transition"><Copy size={14} /></button>
                </div>
              </div>
              <button onClick={copyShareLink} className="flex items-center px-6 py-3 bg-green-600 hover:bg-green-700 rounded-xl text-white font-bold shadow-lg w-full md:w-auto justify-center transition active:scale-95">
                <Share2 size={18} className="mr-2" /> Partilhar Lista
              </button>
            </div>

            {/* --- ÁREA DE FERRAMENTAS (SANFONAS) --- */}
            <div className="grid grid-cols-1 gap-4">
              
              {/* IA SECTION */}
              <div className="bg-gradient-to-br from-indigo-900/40 to-gray-800 rounded-2xl border border-indigo-500/30 overflow-hidden shadow-lg transition-all duration-300">
                <button onClick={() => toggleSection('ai')} className="w-full p-5 flex justify-between items-center text-left hover:bg-white/5 transition-colors">
                  <div className="flex items-center">
                    <Sparkles className="mr-3 text-yellow-400" size={22} />
                    <h3 className="text-lg font-bold text-white">Descobrir por Tema (IA)</h3>
                  </div>
                  <ChevronDown className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'ai' ? 'rotate-180' : ''}`} />
                </button>
                <div className={`transition-all duration-300 ease-in-out ${expandedSection === 'ai' ? 'max-h-[1200px] opacity-100 p-5 pt-0' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                  <div className="pt-4 border-t border-indigo-500/20">
                    <form onSubmit={handleAiSearch} className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text" value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} required
                        placeholder="Ex: filmes brasileiros indicados ao oscar..."
                        className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none text-sm"
                      />
                      <button type="submit" disabled={isAiLoading} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-6 py-3 rounded-xl font-bold text-white transition flex items-center justify-center">
                        {isAiLoading ? <span className="animate-pulse">A consultar...</span> : <Search size={18} />}
                      </button>
                    </form>
                    {aiErrorMsg && <p className="text-red-400 text-[10px] mt-2 flex items-center"><AlertCircle size={12} className="mr-1"/> {aiErrorMsg}</p>}
                    
                    {aiSuggestions.length > 0 && (
                      <div className="mt-6">
                        <h4 className="text-xs font-bold text-indigo-300 uppercase mb-4 tracking-widest">Sugestões Encontradas</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                          {aiSuggestions.map((movie, idx) => (
                            <div key={idx} className="bg-gray-900 p-3 rounded-xl border border-gray-700 flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                              <img src={movie.poster} alt={movie.title} className="aspect-[2/3] object-cover rounded-lg bg-gray-800" />
                              <div className="flex-grow">
                                <p className="text-xs font-bold text-white truncate mb-2">{movie.title}</p>
                                <button 
                                  onClick={() => handleSaveToMyList(movie)}
                                  className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-[10px] font-bold rounded-lg transition flex items-center justify-center"
                                >
                                  <Plus size={12} className="mr-1" /> Adicionar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* MANUAL SECTION */}
              <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-lg transition-all duration-300">
                <button onClick={() => toggleSection('manual')} className="w-full p-5 flex justify-between items-center text-left hover:bg-white/5 transition-colors">
                  <div className="flex items-center">
                    <Film className="mr-3 text-red-500" size={22} />
                    <h3 className="text-lg font-bold text-white">Adicionar por Link IMDb</h3>
                  </div>
                  <ChevronDown className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'manual' ? 'rotate-180' : ''}`} />
                </button>
                <div className={`transition-all duration-300 ease-in-out ${expandedSection === 'manual' ? 'max-h-[500px] opacity-100 p-5 pt-0' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                  <div className="pt-4 border-t border-gray-700">
                    <form onSubmit={handleAddMovie} className="flex flex-col md:flex-row gap-3">
                      <input
                        type="url" value={imdbLink} onChange={(e) => setImdbLink(e.target.value)} required
                        placeholder="Ex: https://www.imdb.com/title/tt0133093/"
                        className="flex-grow bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-red-500 outline-none text-sm"
                      />
                      <select 
                        value={movieStatus} onChange={(e) => setMovieStatus(e.target.value)}
                        className="bg-gray-900 border border-gray-600 rounded-xl px-4 text-white text-sm outline-none"
                      >
                        <option value="Quero assistir">🍿 Quero assistir</option>
                        <option value="Assistido">✅ Assistido</option>
                        <option value="Favorito">⭐ Favorito</option>
                      </select>
                      <button type="submit" disabled={isLoading} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-6 py-3 rounded-xl font-bold text-white transition whitespace-nowrap">
                        {isLoading ? 'A buscar...' : 'Adicionar'}
                      </button>
                    </form>
                    {successMsg && <p className="text-green-400 text-xs mt-2">{successMsg}</p>}
                    {errorMsg && <p className="text-red-400 text-xs mt-2">{errorMsg}</p>}
                  </div>
                </div>
              </div>

              {/* FRIEND SECTION */}
              <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-lg transition-all duration-300">
                <button onClick={() => toggleSection('friend')} className="w-full p-5 flex justify-between items-center text-left hover:bg-white/5 transition-colors">
                  <div className="flex items-center">
                    <Users className="mr-3 text-blue-400" size={22} />
                    <h3 className="text-lg font-bold text-white">Encontrar Amigos</h3>
                  </div>
                  <ChevronDown className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'friend' ? 'rotate-180' : ''}`} />
                </button>
                <div className={`transition-all duration-300 ease-in-out ${expandedSection === 'friend' ? 'max-h-[600px] opacity-100 p-5 pt-0' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                  <div className="pt-4 border-t border-gray-700 flex flex-col md:flex-row gap-6">
                    <div className="flex-grow">
                      <p className="text-xs text-gray-400 mb-3">Cole o ID do seu amigo para visitar a lista dele.</p>
                      <div className="flex gap-2">
                        <input 
                          type="text" placeholder="Cole o ID aqui..."
                          value={friendSearchText} onChange={e => setFriendSearchText(e.target.value)}
                          className="flex-grow bg-gray-900 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white outline-none"
                        />
                        <button onClick={() => { if(friendSearchText) { setTargetUserId(friendSearchText.trim()); navigateTo('publicList'); setActiveFilter('Todos'); } }} className="bg-gray-700 hover:bg-gray-600 px-6 rounded-xl text-sm font-bold">Procurar</button>
                      </div>
                    </div>
                    {savedLists.length > 0 && (
                      <div className="md:w-1/3 border-t md:border-t-0 md:border-l border-gray-700 pt-4 md:pt-0 md:pl-6">
                        <h4 className="text-[10px] uppercase font-bold text-gray-500 mb-3 flex items-center"><Bookmark className="mr-1" size={12}/> Listas Guardadas</h4>
                        <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                          {savedLists.map(list => (
                            <div key={list.id} className="flex items-center justify-between bg-gray-900 p-2 rounded-lg border border-gray-800 group">
                               <span className="text-xs text-gray-300 cursor-pointer hover:text-white truncate" onClick={() => { setTargetUserId(list.friendId); navigateTo('publicList'); setActiveFilter('Todos'); }}>{list.name}</span>
                               <Trash2 size={14} className="text-gray-600 hover:text-red-500 cursor-pointer transition opacity-0 group-hover:opacity-100" onClick={() => handleRemoveSavedList(list.id)}/>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* LISTA PÚBLICA (Visão do Amigo) */}
        {view === 'publicList' && (
          <div className="max-w-5xl mx-auto w-full px-4 py-8">
            <div className="mb-8 bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1 flex items-center"><UserIcon className="mr-3 text-red-500" /> Lista de Amigo</h2>
                <div className="text-[10px] text-gray-500 uppercase tracking-widest bg-gray-900 px-2 py-1 rounded inline-block">Visualizando: <span className="text-red-400 font-mono">{targetUserId}</span></div>
              </div>
              <div className="flex gap-3 mt-4 md:mt-0 w-full md:w-auto">
                {!isGuest && (
                  <button onClick={currentSavedList ? () => handleRemoveSavedList(currentSavedList.id) : handleSaveFriendList} className={`flex-1 md:flex-none text-xs px-4 py-3 rounded-xl font-bold flex items-center justify-center transition ${currentSavedList ? 'bg-gray-700 text-green-400' : 'bg-red-600/20 text-red-400 border border-red-500/50'}`}>
                    {currentSavedList ? <Bookmark className="mr-2 fill-current" size={14}/> : <BookmarkPlus className="mr-2" size={14}/>}
                    {currentSavedList ? 'Guardada' : 'Acompanhar'}
                  </button>
                )}
                <button onClick={() => { navigateTo(isGuest ? 'landing' : 'dashboard'); setTargetUserId(''); setActiveFilter('Todos'); window.history.pushState({}, '', window.location.pathname); }} className="flex-1 md:flex-none text-xs px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition">Voltar</button>
              </div>
            </div>
          </div>
        )}

        {/* --- LISTAGEM DE FILMES (GRID) --- */}
        {(view === 'dashboard' || view === 'publicList') && (
          <div className="max-w-5xl mx-auto w-full px-4 pb-16">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-hide">
                <Filter size={18} className="text-gray-500 mr-1 flex-shrink-0" />
                {['Todos', 'Quero assistir', 'Assistido', 'Favorito'].map((filter) => (
                  <button
                    key={filter} onClick={() => setActiveFilter(filter)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition border ${activeFilter === filter ? 'bg-gray-700 text-white border-gray-500 shadow-lg' : 'bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800'}`}
                  >
                    {filter === 'Todos' ? '📚 Tudo' : filter === 'Quero assistir' ? '🍿 Quero' : filter === 'Assistido' ? '✅ Vi' : '⭐ Top'}
                  </button>
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Ordenar:</span>
                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-gray-900 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 outline-none focus:border-red-500 cursor-pointer transition"
                >
                  <option value="recentes">Mais recentes</option>
                  <option value="antigos">Mais antigos</option>
                  <option value="nota">Melhor nota</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {displayedMovies.length === 0 ? (
                <div className="col-span-full py-24 text-center text-gray-500 animate-in fade-in zoom-in duration-300">
                  <Film size={48} className="mx-auto mb-4 opacity-10" />
                  <p className="text-sm">Nenhum filme por aqui ainda!</p>
                </div>
              ) : (
                displayedMovies.map((movie) => {
                  const isOwner = user?.uid === movie.ownerId;
                  const userRating = movie.ratings?.[user?.uid] || 0;
                  const avgRating = calculateAverageRating(movie.ratings);
                  const currentStatus = movie.status || 'Quero assistir';

                  return (
                    <div key={movie.id} className="bg-gray-800 rounded-2xl overflow-hidden shadow-lg border border-gray-700 flex flex-col relative group transition-all hover:shadow-2xl hover:border-gray-500">
                      <div className="relative aspect-[2/3] w-full bg-gray-900 overflow-hidden">
                        <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
                        <div className={`absolute top-0 left-0 text-[10px] font-bold px-2 py-1 rounded-br-xl shadow-lg backdrop-blur-md ${getStatusColor(currentStatus)}`}>
                          {currentStatus === 'Favorito' ? '⭐' : currentStatus === 'Assistido' ? '✅' : '🍿'}
                        </div>
                        <div className="absolute top-0 right-0 bg-black/70 backdrop-blur-sm text-white px-2 py-1 m-2 rounded-lg flex items-center text-[10px] font-bold shadow-md border border-white/10">
                          <Star size={10} className="text-yellow-400 fill-yellow-400 mr-1" />{avgRating}
                        </div>
                      </div>
                      
                      <div className="p-3 flex-grow flex flex-col">
                        <h3 className="text-xs font-bold text-white mb-2 line-clamp-2 leading-snug" title={movie.title}>{movie.title}</h3>
                        
                        <div className="mt-auto pt-3 border-t border-gray-700/50">
                          {isOwner ? (
                            <div className="space-y-2">
                              <select 
                                value={currentStatus} onChange={(e) => handleUpdateStatus(movie.id, e.target.value)}
                                className={`text-[10px] p-1.5 rounded-lg font-bold w-full truncate outline-none ${getStatusColor(currentStatus)}`}
                              >
                                <option value="Quero assistir" className="bg-gray-800">Quero assistir</option>
                                <option value="Assistido" className="bg-gray-800">Assistido</option>
                                <option value="Favorito" className="bg-gray-800">Favorito</option>
                              </select>
                              <div className="flex justify-end pt-1">
                                <button onClick={() => handleDeleteMovie(movie.id)} className="text-[10px] text-red-500 hover:text-red-400 font-bold transition p-1">Remover</button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">A sua nota</p>
                              <StarRating rating={userRating} onRate={(val) => handleRateMovie(movie.id, movie.ratings, val)} readonly={false} />
                              {!user?.isAnonymous && !movies.some(m => m.ownerId === user?.uid && m.imdbId === movie.imdbId) && (
                                <button onClick={() => handleSaveToMyList(movie)} className="w-full mt-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-[10px] font-bold rounded-lg flex items-center justify-center transition">
                                  <Plus size={10} className="mr-1" /> Copiar
                                </button>
                              )}
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

      <footer className="bg-gray-900 border-t border-gray-800 py-10 mt-auto">
        <div className="max-w-5xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest flex items-center">
            <Film className="mr-2" size={14} /> &copy; {new Date().getFullYear()} Cine Indica
          </div>
          <div className="flex space-x-6 text-xs font-bold">
            <button onClick={() => navigateTo('privacy')} className="text-gray-500 hover:text-red-500 transition">Privacidade</button>
            <button onClick={() => navigateTo('terms')} className="text-gray-500 hover:text-red-500 transition">Termos</button>
          </div>
        </div>
      </footer>
    </div>
  );
}