function QOut() {
    var dest = document.createElement("span")
    document.body.appendChild(dest);
    QQOut.apply(undefined,arguments);
}

function QQOut() {
    var dest = document.body.children;
    dest=dest[dest.length-1];
    if (dest.tagName!="SPAN") {
        dest = document.createElement("span")
        document.body.appendChild(dest);
    }
    var txt = "";
    for(let i=0;i<arguments.length;i++) {
        if(i>0) txt+=" ";
        txt+=arguments[i];
    }
    // dest.textContent = txt;
    $('#output').html( txt );
}

var hrb = new HRB();
// hrb.download("https://www.modharbour.org/modharbour_samples/data/runner.hrb_").then((v)=>{
    hrb.download( "test2.hrb" ).then((v)=>{
    console.log(v);
    hrb.apply();
    MAIN(23);
});
