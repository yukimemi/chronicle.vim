function! chronicle#read#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listRead', [])
endfunction

