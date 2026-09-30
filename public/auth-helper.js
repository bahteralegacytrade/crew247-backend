function authFetch(url, options = {}) {
  const token = localStorage.getItem('crew247_token');
  options.headers = Object.assign({}, options.headers, token ? { 'Authorization': 'Bearer ' + token } : {});

  return fetch(url, options).then(res => {
    if (res.status === 401) {
      localStorage.removeItem('crew247_user_id');
      localStorage.removeItem('crew247_no_hp');
      localStorage.removeItem('crew247_role');
      localStorage.removeItem('crew247_token');
      alert('Sesi Anda sudah berakhir. Silakan login ulang.');
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }
    return res;
  });
}