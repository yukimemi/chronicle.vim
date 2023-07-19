function! chronicle#write#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listWrite', [])
endfunction

