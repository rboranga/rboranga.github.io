import React, { useState, useEffect, useMemo } from 'react';
import { Film, Star, Share2, LogOut, User as UserIcon, Plus, Search, Check, AlertCircle, Copy, LogIn } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithPopup, GoogleAuthProvider, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc 
} from 'firebase/firestore';

// --- 1. CONFIGURAÇÃO FIREBASE (Segura com Variáveis de Ambiente) ---
const firebaseConfig = {
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
const appId = 'cine-indica-app';

// --- 2. CONFIGURAÇÃO DA API OMDb (Segura) ---
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
    <div className="flex space-x-1">
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
            size={24}
            className={`${
              (hoverRating || rating) >= star 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-gray-400'
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
  const [view, setView] = useState('dashboard'); 
  const [targetUserId, setTargetUserId] = useState(''); 
  const [friendSearchText, setFriendSearchText] = useState('');
  
  const [imdbLink, setImdbLink] = useState('');
  const [movieStatus, setMovieStatus] = useState('Quero assistir'); 
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dbError, setDbError] = useState(''); 

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
    });

    const params = new URLSearchParams(window.location.search);
    const sharedUserId = params.get('user');
    if (sharedUserId) {
      setTargetUserId(sharedUserId.trim()); 
      setView('publicList');
    }

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
      console.error("Erro ao procurar filmes:", error);
      setDbError(`Erro de ligação à base de dados (${error.code}). Verifique as regras do Firestore!`);
    });

    return () => unsubscribe();
  }, [user]);

  const displayedMovies = useMemo(() => {
    if (view === 'publicList' && targetUserId) {
      return movies.filter(m => m.ownerId === targetUserId);
    }
    return movies.filter(m => m.ownerId === user?.uid);
  }, [movies, view, targetUserId, user]);

  // INÍCIO DE SESSÃO COM GOOGLE
  const handleGoogleLogin = async () => {
    setErrorMsg('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      if (view !== 'publicList') setView('dashboard');
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao iniciar sessão. Verifique se ativou o Google no painel do Firebase.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
    setView('dashboard');
    setTargetUserId('');
    window.history.pushState({}, document.title, window.location.pathname);
  };

  const handleAddMovie = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    
    // REDIRECIONAMENTO SE FOR VISITANTE
    if (!user || user.isAnonymous) {
      setView('dashboard'); 
      return;
    }

    // REGEX (Aceita m.imdb, /pt/, query params)
    const imdbRegex = /imdb\.com(?:\/[a-zA-Z-]+)?\/title\/(tt\d+)/i;
    const match = imdbLink.match(imdbRegex);
    
    if (!match || !match[1]) {
      setErrorMsg('Ligação inválida. Cole um URL do IMDb aceite.');
      return;
    }

    const imdbId = match[1];
    if (movies.some(m => m.ownerId === user.uid && m.imdbId === imdbId)) {
      setErrorMsg('Já indicou este filme!');
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
      setErrorMsg('Erro ao obter dados do filme. Verifique a ligação e a sua chave da OMDb API.');
    } finally {
      setIsLoading(false);
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
      alert(`Ligação copiada! Envie aos seus amigos:\n\n${shareUrl}`);
    } catch (err) {
      alert('A sua ligação é: ' + shareUrl);
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
      case 'Favorito': return 'bg-purple-600/90 text-white border border-purple-400';
      case 'Assistido': return 'bg-green-600/90 text-white border border-green-400';
      case 'Quero assistir': return 'bg-blue-600/90 text-white border border-blue-400';
      default: return 'bg-gray-700/90 text-gray-200 border border-gray-500'; 
    }
  };

  const isGuest = !user || user.isAnonymous;
  const showAuthForm = view === 'dashboard' && isGuest;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans pb-10">
      <header className="bg-gray-800 border-b border-gray-700 shadow-lg sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => { 
              setView('dashboard'); 
              setTargetUserId(''); 
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
                  title="Terminar Sessão"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-400 border border-gray-600 px-3 py-1 rounded-full">Visitante</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {dbError && (
          <div className="mb-6 bg-red-900/40 border border-red-500 text-red-200 p-4 rounded-xl flex items-center shadow-lg">
             <AlertCircle className="mr-3 flex-shrink-0" size={24} />
             <p>{dbError}</p>
          </div>
        )}

        {/* ECRÃ DE AUTENTICAÇÃO (Google) */}
        {showAuthForm && (
          <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700 mt-10">
            <div className="flex justify-center mb-6">
              <UserIcon size={48} className="text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-center mb-4">
              Aceda à sua Conta
            </h2>
            <p className="text-gray-400 text-center text-sm mb-8">
              Crie as suas próprias listas de filmes e partilhe com amigos com um clique.
            </p>
            
            <button 
              onClick={handleGoogleLogin} 
              className="w-full bg-white hover:bg-gray-100 text-gray-900 font-bold py-3.5 px-4 rounded-xl transition flex items-center justify-center shadow-md"
            >
              <LogIn className="mr-2" size={20} />
              Entrar com o Google
            </button>

            {errorMsg && (
              <div className="mt-4 text-red-400 text-sm bg-red-900/20 p-3 rounded-lg flex">
                <AlertCircle size={16} className="mr-2 flex-shrink-0"/>{errorMsg}
              </div>
            )}
          </div>
        )}

        {/* PAINEL PRIVADO (Dashboard) */}
        {!showAuthForm && view === 'dashboard' && (
          <div className="space-y-8">
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
                Copiar Ligação da Lista
              </button>
            </div>

            <form onSubmit={handleAddMovie} className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700">
              <label className="block text-sm font-medium text-gray-300 mb-2">Cole a ligação do IMDb do filme:</label>
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

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
               <h3 className="text-md font-bold text-gray-300 mb-3">Quer ver a lista de um amigo sem a ligação?</h3>
               <div className="flex gap-2 max-w-md">
                 <input 
                   type="text" placeholder="Cole o ID do amigo aqui..."
                   value={friendSearchText} onChange={e => setFriendSearchText(e.target.value)}
                   className="flex-grow bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                 />
                 <button 
                   onClick={() => { 
                     if(friendSearchText) { 
                       setTargetUserId(friendSearchText.trim()); 
                       setView('publicList'); 
                     } 
                   }}
                   className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition"
                 >
                   Procurar
                 </button>
               </div>
            </div>
          </div>
        )}

        {/* LISTA PÚBLICA (Visão do Amigo) */}
        {!showAuthForm && view === 'publicList' && (
          <div className="mb-8 bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-2 flex items-center">
                <UserIcon className="mr-3 text-red-500" />
                Lista do Amigo
              </h2>
              <p className="text-gray-400 text-sm mb-2">
                Veja a organização do seu amigo e avalie os filmes indicados.
              </p>
              <div className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded inline-block">
                A visualizar ID: <span className="text-red-400 font-mono">{targetUserId}</span>
              </div>
            </div>
            {!isGuest && (
              <button 
                onClick={() => { setView('dashboard'); setTargetUserId(''); window.history.pushState({}, '', window.location.pathname); }}
                className="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition mt-4 md:mt-0"
              >
                Voltar ao meu painel
              </button>
            )}
            {isGuest && (
              <button onClick={() => { setView('dashboard'); }} className="text-sm px-4 py-2 bg-red-600 hover:bg-red-700 shadow-md rounded-lg font-bold mt-4 md:mt-0 flex items-center">
                 <LogIn size={16} className="mr-2"/> Iniciar Sessão
              </button>
            )}
          </div>
        )}

        {/* RENDERIZAÇÃO DOS FILMES */}
        {!showAuthForm && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displayedMovies.length === 0 ? (
              <div className="col-span-full py-16 text-center text-gray-500">
                <Film size={48} className="mx-auto mb-4 opacity-20" />
                <p>{view === 'publicList' ? 'Nenhuma indicação encontrada para este utilizador.' : 'A sua lista está vazia! Que tal adicionar um filme?'}</p>
              </div>
            ) : (
              displayedMovies.map((movie) => {
                const isOwner = user?.uid === movie.ownerId;
                const userRating = movie.ratings?.[user?.uid] || 0;
                const totalRatingsCount = movie.ratings ? Object.keys(movie.ratings).length : 0;
                const avgRating = calculateAverageRating(movie.ratings);
                
                const currentStatus = movie.status || 'Quero assistir';

                return (
                  <div key={movie.id} className="bg-gray-800 rounded-2xl overflow-hidden shadow-xl border border-gray-700 flex flex-col group">
                    <div className="relative h-[300px] w-full bg-gray-900 overflow-hidden">
                      <img 
                        src={movie.poster} alt={movie.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute top-0 right-0 bg-black/70 backdrop-blur-sm text-white px-3 py-1 m-2 rounded-full flex items-center text-sm font-bold shadow-md">
                        <Star size={14} className="text-yellow-400 fill-yellow-400 mr-1" />
                        {avgRating}
                      </div>
                      
                      {!isOwner && (
                        <div className={`absolute bottom-0 left-0 text-xs font-bold px-3 py-1.5 m-2 rounded-lg shadow-md backdrop-blur-md ${getStatusColor(currentStatus)}`}>
                          {currentStatus}
                        </div>
                      )}
                    </div>
                    
                    <div className="p-5 flex-grow flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-2 line-clamp-1" title={movie.title}>{movie.title}</h3>
                      <p className="text-sm text-gray-400 mb-4 line-clamp-3 flex-grow">{movie.plot}</p>
                      
                      <div className="mt-auto pt-4 border-t border-gray-700">
                        {isOwner ? (
                          <div className="space-y-3">
                            <div className="flex flex-col space-y-1">
                              <span className="text-[10px] uppercase font-bold text-gray-500">Estado</span>
                              <select 
                                value={currentStatus}
                                onChange={(e) => handleUpdateStatus(movie.id, e.target.value)}
                                className={`text-xs p-1.5 rounded-md font-bold focus:outline-none focus:ring-1 focus:ring-gray-400 ${getStatusColor(currentStatus)}`}
                              >
                                <option value="Quero assistir" className="bg-gray-800 text-white">Quero assistir</option>
                                <option value="Assistido" className="bg-gray-800 text-white">Assistido</option>
                                <option value="Favorito" className="bg-gray-800 text-white">Favorito</option>
                              </select>
                            </div>
                            
                            <div className="flex justify-between items-center pt-2 border-t border-gray-700/50">
                              <div className="text-xs text-gray-400">
                                {totalRatingsCount} {totalRatingsCount === 1 ? 'voto' : 'votos'}
                              </div>
                              <button onClick={() => handleDeleteMovie(movie.id)} className="text-xs text-red-400 hover:text-red-300 font-medium">
                                Remover
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-400 font-medium">A sua nota para este filme:</p>
                            <StarRating rating={userRating} onRate={(val) => handleRateMovie(movie.id, movie.ratings, val)} readonly={false} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}