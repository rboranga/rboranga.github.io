import React, { useState, useEffect, useMemo } from 'react';
import { Film, Star, Share2, LogOut, User as UserIcon, Plus, Search, Check, AlertCircle } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc 
} from 'firebase/firestore';

// --- 1. CONFIGURAÇÃO FIREBASE (Usando variáveis de ambiente) ---
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
    console.error("Erro ao buscar dados:", error);
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
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

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
      setTargetUserId(sharedUserId);
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
    }, (error) => {
      console.error("Erro ao buscar filmes:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const displayedMovies = useMemo(() => {
    if (view === 'publicList' && targetUserId) {
      return movies.filter(m => m.ownerId === targetUserId);
    }
    return movies.filter(m => m.ownerId === user?.uid);
  }, [movies, view, targetUserId, user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setEmail('');
      setPassword('');
      if (view !== 'publicList') setView('dashboard');
    } catch (err) {
      setErrorMsg(err.message.includes('auth/') ? 'Credenciais inválidas ou e-mail já em uso.' : err.message);
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
    
    if (!user || user.isAnonymous) {
      setErrorMsg('Crie uma conta para adicionar filmes.');
      return;
    }

    const imdbRegex = /imdb\.com\/title\/(tt\d+)/i;
    const match = imdbLink.match(imdbRegex);
    
    if (!match || !match[1]) {
      setErrorMsg('Link inválido. Cole a URL completa do IMDb.');
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
        ratings: {},
        createdAt: Date.now()
      });
      
      setSuccessMsg('Filme adicionado com sucesso!');
      setImdbLink('');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg('Erro ao buscar dados do filme. Verifique o link e sua chave da OMDb API.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMovie = async (movieId) => {
    if (confirm('Deseja realmente remover esta indicação?')) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'recommendations', movieId));
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
      alert("Erro ao computar voto. Verifique as regras do Firestore.");
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
      alert(`Link copiado! Envie para seus amigos:\n\n${shareUrl}`);
    } catch (err) {
      alert('Seu link é: ' + shareUrl);
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

  const showAuthForm = view === 'dashboard' && user?.isAnonymous;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
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
            {!user?.isAnonymous ? (
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
              <span className="text-sm text-gray-400 border border-gray-600 px-3 py-1 rounded-full">Visitante</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {showAuthForm && (
          <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700 mt-10">
            <div className="flex justify-center mb-6">
              <UserIcon size={48} className="text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-center mb-6">
              {isRegistering ? 'Criar sua Conta' : 'Acesse sua Conta'}
            </h2>
            <p className="text-gray-400 text-center text-sm mb-6">
              Faça login para gerenciar suas listas. Visitantes só podem votar nas listas dos amigos.
            </p>
            
            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <input 
                  type="email" placeholder="E-mail" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-1 focus:ring-red-500"
                />
              </div>
              <div>
                <input 
                  type="password" placeholder="Senha" required
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-1 focus:ring-red-500"
                />
              </div>
              
              {errorMsg && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg flex"><AlertCircle size={16} className="mr-2"/>{errorMsg}</div>}

              <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg transition">
                {isRegistering ? 'Registrar' : 'Entrar'}
              </button>
            </form>
            
            <div className="mt-6 text-center">
              <button onClick={() => setIsRegistering(!isRegistering)} className="text-gray-400 hover:text-white text-sm underline">
                {isRegistering ? 'Já tem conta? Faça Login' : 'Não tem conta? Registre-se'}
              </button>
            </div>
          </div>
        )}

        {!showAuthForm && view === 'dashboard' && (
          <div className="space-y-8">
            <div className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">Suas Indicações</h2>
                <p className="text-gray-400 text-sm">Adicione filmes e compartilhe seu link.</p>
              </div>
              <button 
                onClick={copyShareLink}
                className="flex items-center px-5 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg text-white font-medium transition whitespace-nowrap"
              >
                <Share2 size={18} className="mr-2" />
                Copiar Link da Lista
              </button>
            </div>

            <form onSubmit={handleAddMovie} className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700">
              <label className="block text-sm font-medium text-gray-300 mb-2">Cole o link do IMDb do filme:</label>
              <div className="flex flex-col sm:flex-row gap-3">
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
                <button type="submit" disabled={isLoading} className="flex items-center justify-center px-6 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg font-bold">
                  {isLoading ? 'Buscando...' : <><Plus size={20} className="mr-2"/> Adicionar</>}
                </button>
              </div>
              {successMsg && <p className="text-green-400 text-sm mt-3 flex items-center"><Check size={14} className="mr-1"/> {successMsg}</p>}
              {errorMsg && <p className="text-red-400 text-sm mt-3 flex items-center"><AlertCircle size={14} className="mr-1"/> {errorMsg}</p>}
            </form>

            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
               <h3 className="text-md font-bold text-gray-300 mb-3">Quer ver a lista de um amigo sem o link?</h3>
               <div className="flex gap-2 max-w-md">
                 <input 
                   type="text" placeholder="Cole o ID do amigo aqui..."
                   value={friendSearchText} onChange={e => setFriendSearchText(e.target.value)}
                   className="flex-grow bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                 />
                 <button 
                   onClick={() => { if(friendSearchText) { setTargetUserId(friendSearchText); setView('publicList'); } }}
                   className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium"
                 >
                   Buscar
                 </button>
               </div>
            </div>
          </div>
        )}

        {!showAuthForm && view === 'publicList' && (
          <div className="mb-8 bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-2 flex items-center">
                <UserIcon className="mr-3 text-red-500" />
                Indicações de um Amigo
              </h2>
              <p className="text-gray-400 text-sm">
                Clique nas estrelas abaixo para avaliar os filmes indicados.
              </p>
            </div>
            {!user?.isAnonymous && (
              <button 
                onClick={() => { setView('dashboard'); setTargetUserId(''); window.history.pushState({}, '', window.location.pathname); }}
                className="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
              >
                Voltar ao meu painel
              </button>
            )}
            {user?.isAnonymous && (
              <button onClick={() => setView('dashboard')} className="text-sm px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-bold">
                Criar minha própria lista
              </button>
            )}
          </div>
        )}

        {!showAuthForm && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displayedMovies.length === 0 ? (
              <div className="col-span-full py-16 text-center text-gray-500">
                <Film size={48} className="mx-auto mb-4 opacity-20" />
                <p>{view === 'publicList' ? 'Nenhuma indicação encontrada para este usuário.' : 'Você ainda não adicionou nenhum filme.'}</p>
              </div>
            ) : (
              displayedMovies.map((movie) => {
                const isOwner = user?.uid === movie.ownerId;
                const userRating = movie.ratings?.[user?.uid] || 0;
                const totalRatingsCount = movie.ratings ? Object.keys(movie.ratings).length : 0;
                const avgRating = calculateAverageRating(movie.ratings);

                return (
                  <div key={movie.id} className="bg-gray-800 rounded-2xl overflow-hidden shadow-xl border border-gray-700 flex flex-col group">
                    <div className="relative h-[300px] w-full bg-gray-900 overflow-hidden">
                      <img 
                        src={movie.poster} alt={movie.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute top-0 right-0 bg-black/70 backdrop-blur-sm text-white px-3 py-1 m-2 rounded-full flex items-center text-sm font-bold">
                        <Star size={14} className="text-yellow-400 fill-yellow-400 mr-1" />
                        {avgRating}
                      </div>
                    </div>
                    
                    <div className="p-5 flex-grow flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-2 line-clamp-1" title={movie.title}>{movie.title}</h3>
                      <p className="text-sm text-gray-400 mb-4 line-clamp-3 flex-grow">{movie.plot}</p>
                      
                      <div className="mt-auto pt-4 border-t border-gray-700">
                        {isOwner ? (
                          <div className="flex justify-between items-center">
                            <div className="text-xs text-gray-400">
                              {totalRatingsCount} {totalRatingsCount === 1 ? 'avaliação' : 'avaliações'}
                            </div>
                            <button onClick={() => handleDeleteMovie(movie.id)} className="text-xs text-red-400 hover:text-red-300">
                              Remover
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-400 font-medium">Sua nota para este filme:</p>
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